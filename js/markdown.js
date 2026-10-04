/**
 * Markdown serialisation for notes. Pure functions shared by the on-device
 * export (browser) and the GitHub backup cron (server).
 */

export function slugify(text, max = 60) {
  const slug = String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return slug || 'untitled';
}

function yamlString(value) {
  return JSON.stringify(String(value ?? ''));
}

function iso(ms) {
  return ms ? new Date(ms).toISOString() : null;
}

export function notePath(note, projectName) {
  const folder = projectName ? `projects/${slugify(projectName, 40)}` : 'inbox';
  return `${folder}/${slugify(note.title)}--${note.id}.md`;
}

export function noteToMarkdown(note, projectName, tags = []) {
  const lines = ['---'];
  lines.push(`id: ${yamlString(note.id)}`);
  lines.push(`title: ${yamlString(note.title)}`);
  if (projectName) lines.push(`project: ${yamlString(projectName)}`);
  if (tags.length) lines.push(`tags: [${tags.map(yamlString).join(', ')}]`);
  if (note.pinned) lines.push('pinned: true');
  lines.push(`created: ${iso(note.createdAt)}`);
  lines.push(`updated: ${iso(note.updatedAt)}`);
  lines.push('---', '');
  lines.push(note.body || '');
  return lines.join('\n').replace(/\n*$/, '\n');
}

/**
 * Build the full set of files for a backup/export: [{ path, content }]
 */
export function buildMarkdownFiles(notes, projects, extractTags) {
  const projectNames = new Map(projects.filter((p) => !p.deletedAt).map((p) => [p.id, p.name]));
  const files = [];
  for (const note of notes) {
    if (note.deletedAt) continue;
    const projectName = projectNames.get(note.projectId) || null;
    const tags = extractTags ? extractTags(note.title + '\n' + note.body) : [];
    files.push({ path: notePath(note, projectName), content: noteToMarkdown(note, projectName, tags) });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  files.unshift({
    path: 'README.md',
    content: [
      '# Palate notes',
      '',
      `${files.length} notes.`,
      '',
      'One Markdown file per note. Front matter holds the id, project, tags and timestamps.',
      ''
    ].join('\n')
  });
  return files;
}
