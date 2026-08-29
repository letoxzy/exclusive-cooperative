export function validatePassword(password = "") {
  const value = String(password);

  if (value.length < 8) {
    return "Password must be at least 8 characters long.";
  }

  if (!/[a-z]/.test(value)) {
    return "Password must contain at least one lowercase letter.";
  }

  if (!/[A-Z]/.test(value)) {
    return "Password must contain at least one uppercase letter.";
  }

  if (!/\d/.test(value)) {
    return "Password must contain at least one number.";
  }

  if (!/[^A-Za-z0-9\s]/.test(value)) {
    return "Password must contain at least one special character.";
  }

  return null;
}
