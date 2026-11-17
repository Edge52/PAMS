/**
 * The rule for new passwords (wave 27). Pure. Applied only when a password is set or changed (setup, Your account,
 * an administrator's reset or a new user), never at sign-in, so people with older, shorter passwords still get in.
 * Demo accounts are made by the seed with `hashPassword` directly and keep "demo1234".
 */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;

/** The rule in words, shown beside every new-password field. */
export const PASSWORD_RULE = `At least ${MIN_PASSWORD_LENGTH} characters. Not a common password, and not containing your email name. A few words make a good one.`;

/**
 * Very common passwords and the words they are built on (from public lists of leaked passwords, plus local ones).
 * A password is refused when it is one of these, or one of these with digits and symbols around it ("Password123!").
 */
const COMMON = new Set([
  "password", "passw0rd", "p@ssword", "p@ssw0rd", "pass", "passcode", "password1", "letmein", "welcome", "welcome1",
  "qwerty", "qwertyuiop", "asdfgh", "asdfghjkl", "zxcvbnm", "azerty", "abc", "abcd", "abcdef", "abcdefgh",
  "abcdefghijkl", "iloveyou", "admin", "administrator", "root", "user", "guest", "test", "tester", "demo",
  "login", "secret", "master", "dragon", "monkey", "football", "soccer", "baseball", "superman", "batman",
  "princess", "sunshine", "shadow", "starwars", "whatever", "trustno1", "freedom", "hello", "hellohello", "changeme",
  "default", "access", "computer", "internet", "samsung", "google", "apple", "microsoft", "facebook", "summer",
  "winter", "spring", "autumn", "love", "lovely", "baby", "angel", "michael", "jordan", "charlie",
  "hospital", "doctor", "nurse", "medical", "pams", "hpams", "egypt", "cairo", "misr", "allah",
  "mohamed", "mohammed", "ahmed", "mahmoud", "ali", "omar", "hassan", "hussein", "mostafa", "mustafa",
  "123456", "1234567", "12345678", "123456789", "1234567890", "12345678910", "123456789012", "123123", "123123123", "111111",
  "000000", "121212", "654321", "987654321", "0987654321", "112233", "123321", "1q2w3e4r", "1q2w3e4r5t", "1qaz2wsx",
  "qazwsx", "qwe123", "zaq12wsx", "aa123456", "a123456", "abc123", "abc12345", "password123", "qwerty123", "iloveyou123",
]);

/** The word inside a password once digits and symbols at either end are taken off: "!!Password2026" → "password". */
const core = (s: string) => s.replace(/^[^a-z]+|[^a-z]+$/g, "");

/** The person's email name ("hisham.ali" from hisham.ali@x.com) and its parts of 4 letters or more. */
function emailNames(email: string): string[] {
  const local = email.toLowerCase().split("@")[0] ?? "";
  const parts = local.split(/[._+\-]+/).filter((p) => p.length >= 4);
  return [...new Set([local, ...parts])].filter((p) => p.length >= 3);
}

/** Plain-language problem with a new password, or null when it is acceptable. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return "That password is too long.";
  const low = password.toLowerCase();
  if (/^(.)\1+$/.test(password)) return "Don't use one repeated character.";
  if (COMMON.has(low) || COMMON.has(core(low)) || COMMON.has(low.replace(/[^a-z0-9]/g, ""))) return "That is one of the most common passwords. Choose something less easy to guess.";
  if (/^(.{1,4})\1+$/.test(low)) return "Don't repeat a short pattern, like abcabcabc.";
  if (email) {
    if (low.includes(email.toLowerCase())) return "Don't use your email address in the password.";
    const name = emailNames(email).find((n) => low.includes(n));
    if (name) return "Don't use your email name in the password.";
  }
  return null;
}
