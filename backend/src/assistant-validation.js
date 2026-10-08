const MAX_QUESTION_LENGTH = 500;

export function validateAssistantQuestion(value) {
  const question = value && typeof value === "object" && !Array.isArray(value)
    ? value.question
    : undefined;

  if (typeof question !== "string") {
    return invalid("Enter a question for the SmartStock assistant.");
  }

  const normalized = question.trim();
  if (!normalized) {
    return invalid("Enter a question for the SmartStock assistant.");
  }
  if (normalized.length > MAX_QUESTION_LENGTH) {
    return invalid(`Questions must be ${MAX_QUESTION_LENGTH} characters or fewer.`);
  }

  return { valid: true, question: normalized };
}

function invalid(error) {
  return { valid: false, error };
}
