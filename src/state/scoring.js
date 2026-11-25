/**
 * Scoring and final summary. Only completed (executed) questions count as
 * correct/incorrect; unanswered questions earn zero and are reported separately.
 */

export const PERFORMANCE_BANDS = [
  { min: 90, label: 'Excellent', tone: 'success' },
  { min: 70, label: 'Good', tone: 'success' },
  { min: 50, label: 'Fair', tone: 'warning' },
  { min: 0, label: 'Needs Improvement', tone: 'danger' },
];

export function performanceFor(percentage) {
  return PERFORMANCE_BANDS.find((band) => percentage >= band.min) ?? PERFORMANCE_BANDS.at(-1);
}

const percent = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

const emptyBucket = () => ({ total: 0, correct: 0, incorrect: 0, unanswered: 0, earnedPoints: 0, totalPoints: 0, accuracy: 0 });

/**
 * Only executed questions count as answered. Unanswered questions earn zero
 * points and are reported separately: they lower the score, but not the
 * accuracy, which is correct ÷ answered.
 *
 * @param {Array<{ id: string, points: number, difficulty?: string }>} questions
 * @param {Record<string, { status: string, evaluation?: { isCorrect: boolean, pointsEarned: number } }>} answers
 */
export function computeSummary(questions, answers) {
  let completed = 0;
  let correct = 0;
  let earnedPoints = 0;
  let totalPoints = 0;
  const byDifficulty = {};

  for (const question of questions) {
    const bucket = (byDifficulty[question.difficulty ?? 'Medium'] ??= emptyBucket());
    bucket.total += 1;
    bucket.totalPoints += question.points;
    totalPoints += question.points;

    const answer = answers[question.id];
    if (answer?.status !== 'done' || !answer.evaluation) {
      bucket.unanswered += 1;
      continue;
    }
    completed += 1;
    if (answer.evaluation.isCorrect) {
      correct += 1;
      earnedPoints += answer.evaluation.pointsEarned;
      bucket.correct += 1;
      bucket.earnedPoints += answer.evaluation.pointsEarned;
    } else {
      bucket.incorrect += 1;
    }
  }
  for (const bucket of Object.values(byDifficulty)) {
    bucket.accuracy = percent(bucket.correct, bucket.correct + bucket.incorrect);
  }

  const percentage = percent(earnedPoints, totalPoints);

  return {
    totalQuestions: questions.length,
    completed,
    correct,
    incorrect: completed - correct,
    unanswered: questions.length - completed,
    earnedPoints,
    totalPoints,
    percentage, // score: earned ÷ maximum points
    accuracy: percent(correct, completed), // correct ÷ answered
    byDifficulty,
    performance: performanceFor(percentage),
  };
}
