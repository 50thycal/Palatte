import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tidy, extractTodos, similarity, voteProject, planChanges, basicResult, MIN_SIMILARITY } from '../js/organize/heuristics.js';
import { buildPrompt, parseResult, estimateTokens } from '../js/organize/prompt.js';

const projects = [{ id: 'p1', name: 'Work' }, { id: 'p2', name: 'Home Reno' }];

test('tidy fixes sloppy capture without changing words', () => {
  const input = 'met w sarah today  ,talked about pricing.  she thinks per seat is right\n* follow up friday\n• i need numbers';
  assert.equal(tidy(input), 'Met w sarah today, talked about pricing. She thinks per seat is right\n- Follow up friday\n- I need numbers');
  assert.equal(tidy('see www.example.com and v1.2.3'), 'See www.example.com and v1.2.3');
  assert.equal(tidy('a\n\n\n\nb'), 'A\n\nB');
});

test('extracts explicit to-dos only', () => {
  const text = 'call notes\ntodo: email the contractor\nneed to buy tiles.\n- [ ] already listed\nthe weather was nice';
  assert.deepEqual(extractTodos(text), ['Email the contractor', 'Need to buy tiles']);
});

test('similarity measures how much wording changed', () => {
  assert.equal(similarity('the quick brown fox', 'The quick, brown fox.'), 1);
  assert.ok(similarity('i went to the store and got milk', 'I went to the store and got some milk') > 0.9);
  assert.ok(similarity('i went to the store and got milk', 'Grocery run summary: dairy purchased') < 0.3);
});

test('project vote needs clear agreement among similar notes', () => {
  const n = (projectId) => ({ note: { projectId } });
  assert.equal(voteProject([{ ...n('p1'), score: 0.5 }, { ...n('p1'), score: 0.4 }, { ...n('p2'), score: 0.1 }]), 'p1');
  assert.equal(voteProject([{ ...n('p1'), score: 0.5 }, { ...n('p2'), score: 0.5 }]), null);
  assert.equal(voteProject([{ ...n('p1'), score: 0.9 }]), 'p1');
  assert.equal(voteProject([{ ...n('p1'), score: 0.1 }]), null);
  assert.equal(voteProject([{ ...n('p1'), score: 0.9 }, { ...n(null), score: 0.8 }, { ...n(null), score: 0.8 }]), 'p1');
});

test('planChanges applies a faithful cleanup, todos, tags, title and project', () => {
  const note = { title: 'met sarah re pricing', body: 'met sarah re pricing  ,she said per seat. need to send her the deck', projectId: null };
  const { patch, report } = planChanges(note, {
    title: 'Pricing chat with Sarah',
    project: 'work',
    tags: ['Pricing', '#sales'],
    todos: ['Send Sarah the deck'],
    cleaned: 'Met Sarah re pricing, she said per seat. Need to send her the deck.'
  }, { projects, existingTags: ['pricing'], keepProject: false });
  assert.equal(report.cleanup, 'applied');
  assert.equal(patch.title, 'Pricing chat with Sarah');
  assert.equal(patch.projectId, 'p1');
  assert.equal(patch.body,
    'Met Sarah re pricing, she said per seat. Need to send her the deck.\n\nTo-do\n- [ ] Send Sarah the deck\n\n#pricing #sales');
});

test('planChanges rejects rewrites that drift from the original', () => {
  const note = { title: 'x', body: 'kitchen tiles are 4 bucks each, need 200, maybe grey', projectId: null };
  const { patch, report } = planChanges(note, {
    title: '', cleaned: 'The homeowner is evaluating flooring options for the kitchen renovation project.', tags: [], todos: []
  }, { projects, keepProject: false });
  assert.equal(report.cleanup, 'rejected');
  assert.ok(report.similarity < MIN_SIMILARITY);
  assert.equal(patch.body, undefined);
});

test('planChanges respects an explicit project and suggests new ones', () => {
  const note = { title: 't', body: 'garden plan: tomatoes and basil', projectId: null };
  const keep = planChanges(note, { project: 'Work' }, { projects, keepProject: true });
  assert.equal(keep.patch.projectId, undefined);
  const suggest = planChanges(note, { project: '', newProject: 'Garden' }, { projects, keepProject: false });
  assert.equal(suggest.patch.projectId, undefined);
  assert.equal(suggest.report.suggestedProject, 'Garden');
  const voted = planChanges(note, { project: '' }, { projects, keepProject: false, votedProjectId: 'p2' });
  assert.equal(voted.patch.projectId, 'p2');
});

test('planChanges does not duplicate existing tags or checklist items', () => {
  const note = { title: 't', body: 'stuff #pricing\n\n- [ ] Send deck', projectId: 'p1' };
  const { patch } = planChanges(note, { tags: ['pricing'], todos: ['send deck'] }, { projects, keepProject: true });
  assert.equal(patch.body, undefined);
});

test('basic result tidies and extracts to-dos', () => {
  const r = basicResult({ body: 'call mom\ntodo: book flights' });
  assert.equal(r.cleaned, 'Call mom\nTodo: book flights');
  assert.deepEqual(r.todos, ['Book flights']);
});

test('prompt fits the 4096-token window and skips rewriting long notes', () => {
  const short = buildPrompt({ body: 'quick note about the roof' }, { projects, tags: ['reno'] });
  assert.equal(short.cleans, true);
  assert.match(short.user, /Projects: Work \| Home Reno/);
  assert.ok(estimateTokens(short.system + short.user) + short.maxTokens < 4096);

  const long = buildPrompt({ body: 'word '.repeat(2500) }, { projects });
  assert.equal(long.cleans, false);
  assert.equal(long.schema.required.includes('cleaned'), false);
  assert.ok(estimateTokens(long.system + long.user) + long.maxTokens < 4096);
});

test('parseResult normalises model JSON', () => {
  const r = parseResult('{"title":"T","project":"Work","new_project":"","tags":["a",3],"todos":[],"cleaned":"x"}');
  assert.deepEqual(r, { title: 'T', project: 'Work', newProject: '', tags: ['a'], todos: [], cleaned: 'x' });
});

test('progress messages map to download vs GPU-load stages', async () => {
  const { phaseOf, MODELS, MODEL_ORDER } = await import('../js/organize/llm.js');
  assert.equal(phaseOf('Fetching param cache[3/40]: 210MB fetched. 8% completed'), 'download');
  assert.equal(phaseOf('Loading model from cache[12/40]: 900MB loaded. 30% completed'), 'load');
  assert.equal(phaseOf('Finish loading on Apple GPU'), 'load');
  assert.equal(phaseOf(''), null);
  // Step-down order goes from largest to smallest memory footprint
  const mem = MODEL_ORDER.map((k) => MODELS[k].memoryMB);
  assert.deepEqual([...mem].sort((a, b) => b - a), mem);
});
