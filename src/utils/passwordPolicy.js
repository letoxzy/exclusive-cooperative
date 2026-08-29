export const getPasswordChecks = (password = "") => {
  const value = String(password);

  return {
    length: value.length >= 8,
    upperLower: /[a-z]/.test(value) && /[A-Z]/.test(value),
    number: /\d/.test(value),
    special: /[^A-Za-z0-9\s]/.test(value),
  };
};

export const isStrongPassword = (password = "") =>
  Object.values(getPasswordChecks(password)).every(Boolean);
