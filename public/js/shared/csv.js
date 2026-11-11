// Question bank validation. Runs in the host's browser for the preview and again on the server.
export const HEADER = ['question', 'correct answer', 'incorrect answer 1', 'incorrect answer 2', 'incorrect answer 3'];
export const LIMITS = { rows: 500, question: 200, answer: 80 };

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const key = (s) => norm(s).toLowerCase();

export function isHeaderRow(row) {
  if (!Array.isArray(row) || row.length < 2) return false;
  return HEADER.slice(0, 3).every((h, i) => key(row[i]).replace(/\s+/g, ' ') === h);
}

/**
 * @param {string[][]} rows raw rows including the header row
 * @returns {{questions:{q:string,a:string,w:string[]}[], skipped:{row:number,reason:string}[], warnings:string[], usable:number, preview:string[][]}}
 */
export function validateRows(rows) {
  const questions = [];
  const skipped = [];
  const warnings = [];
  if (!Array.isArray(rows)) rows = [];
  let start = 0;
  if (rows.length && isHeaderRow(rows[0])) start = 1;
  else if (rows.length) warnings.push('The first row does not look like the header (Question, Correct Answer, Incorrect Answer 1, ...), so it was read as a question.');

  const dataRows = rows.slice(start);
  if (dataRows.length > LIMITS.rows) warnings.push(`Only the first ${LIMITS.rows} rows were used (the file has ${dataRows.length}).`);
  const seen = new Map();
  const names = ['Question', 'Correct Answer', 'Incorrect Answer 1', 'Incorrect Answer 2', 'Incorrect Answer 3'];

  dataRows.slice(0, LIMITS.rows).forEach((raw, idx) => {
    const rowNum = idx + start + 1; // spreadsheet row number
    const cells = (Array.isArray(raw) ? raw : []).slice(0, 5).map(norm);
    while (cells.length < 5) cells.push('');
    if (cells.every((c) => !c)) return; // blank line
    const [q, a, w1, w2, w3] = cells;
    const fail = (reason) => skipped.push({ row: rowNum, reason: `Row ${rowNum} skipped: ${reason}` });
    if (!q) return fail('Question is empty.');
    if (!a) return fail('Correct Answer is empty.');
    if (!w1) return fail('Incorrect Answer 1 is empty.');
    if (q.length > LIMITS.question) return fail(`Question is longer than ${LIMITS.question} characters.`);
    for (let i = 1; i < 5; i++) if (cells[i].length > LIMITS.answer) return fail(`${names[i]} is longer than ${LIMITS.answer} characters.`);
    const wrong = [w1, w2, w3].filter(Boolean);
    for (let i = 0; i < 3; i++) {
      if (cells[i + 2] && key(cells[i + 2]) === key(a)) return fail(`Incorrect Answer ${i + 1} is the same as the Correct Answer.`);
    }
    const uniqWrong = [...new Map(wrong.map((w) => [key(w), w])).values()];
    const k = key(q);
    if (seen.has(k)) warnings.push(`Duplicate question on rows ${seen.get(k)} and ${rowNum}: "${q.slice(0, 60)}"`);
    else seen.set(k, rowNum);
    questions.push({ q, a, w: uniqWrong, row: rowNum });
  });

  if (questions.length > 0 && questions.length < 20) warnings.push(`Only ${questions.length} usable questions. 40 or more is best, or students will see repeats quickly.`);
  if (questions.length === 0) warnings.push('No usable questions were found.');
  const preview = questions.slice(0, 10).map((x) => [x.q, x.a, ...x.w]);
  return { questions, skipped, warnings, usable: questions.length, preview };
}

export function templateCsv() {
  return [
    'Question,Correct Answer,Incorrect Answer 1,Incorrect Answer 2,Incorrect Answer 3',
    'What is the past tense of run?,ran,runned,runs,running',
    'Which word is an adjective?,happy,quickly,jump,under',
    'She ___ to school every day.,walks,walk,walking,walked',
  ].join('\r\n') + '\r\n';
}
