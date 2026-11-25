/** Derives the display status of a question from its answer record. */
export function questionStatus(answer) {
  if (!answer) return 'unanswered';
  if (answer.status === 'running') return 'running';
  if (answer.status === 'done') return answer.evaluation?.isCorrect ? 'correct' : 'incorrect';
  return answer.selectedOptionId ? 'selected' : 'unanswered';
}

export const STATUS_LABELS = {
  unanswered: 'Not answered',
  selected: 'Answer selected',
  running: 'Running',
  correct: 'Correct',
  incorrect: 'Incorrect',
};
