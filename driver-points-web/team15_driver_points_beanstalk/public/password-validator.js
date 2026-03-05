/**
 * Password Validation Utility
 * Enforces password strength requirements
 */

const PASSWORD_RULES = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChar: true,
  specialChars: '!@#$%^&*()_+-=[]{}|;:",.<>?'
};

/**
 * Validates a password against all rules
 * @param {string} password - The password to validate
 * @returns {object} - { isValid: boolean, errors: string[] }
 */
function validatePassword(newPassword, currentPassword = null) {
  const errors = [];

  // Check minimum length
  if (!newPassword || newPassword.length < PASSWORD_RULES.minLength) {
    errors.push(`Password must be at least ${PASSWORD_RULES.minLength} characters long`);
  }

  // Check for uppercase
  if (PASSWORD_RULES.requireUppercase && !/[A-Z]/.test(newPassword)) {
    errors.push('Password must contain at least 1 uppercase letter (A-Z)');
  }

  // Check for lowercase
  if (PASSWORD_RULES.requireLowercase && !/[a-z]/.test(newPassword)) {
    errors.push('Password must contain at least 1 lowercase letter (a-z)');
  }

  // Check for numbers
  if (PASSWORD_RULES.requireNumbers && !/[0-9]/.test(newPassword)) {
    errors.push('Password must contain at least 1 number (0-9)');
  }

  // Check for special characters
  if (PASSWORD_RULES.requireSpecialChar) {
    const hasSpecialChar = PASSWORD_RULES.specialChars.split('').some(char => newPassword.includes(char));
    if (!hasSpecialChar) {
      errors.push(`Password must contain at least 1 special character (${PASSWORD_RULES.specialChars})`);
    }
  }

  // check if new password contains sequences same characters from current password
  if (currentPassword != null) {
    stringLength = (currentPassword.length / 2) + 2;
    for (let i = 0; i <= currentPassword.length - stringLength; i++) {
      for (let len = stringLength; len <= currentPassword.length - i; len++) {
        const substring = currentPassword.slice(i, i + len);
        if (newPassword.includes(substring)) {
          errors.push('Password must not contain sequences of characters from your old password');
        }
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors: errors
  };
}

/**
 * Gets password strength percentage (0-100)
 * @param {string} password - The password to check
 * @returns {number} - Strength percentage
 */
function getPasswordStrength(password) {
  let strength = 0;
  if (!password) return strength;

  // 20 points for each rule met
  if (password.length >= PASSWORD_RULES.minLength) strength += 20;
  if (/[A-Z]/.test(password)) strength += 20;
  if (/[a-z]/.test(password)) strength += 20;
  if (/[0-9]/.test(password)) strength += 20;
  if (PASSWORD_RULES.specialChars.split('').some(char => password.includes(char))) strength += 20;

  return Math.min(strength, 100);
}

/**
 * Gets strength label
 * @param {number} strength - Strength percentage (0-100)
 * @returns {string} - Label (weak, fair, good, strong)
 */
function getStrengthLabel(strength) {
  if (strength < 40) return 'Weak';
  if (strength < 60) return 'Fair';
  if (strength < 80) return 'Good';
  return 'Strong';
}

// Export for use in HTML
window.PasswordValidator = {
  validatePassword,
  getPasswordStrength,
  getStrengthLabel,
  PASSWORD_RULES
};