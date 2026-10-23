import { LOGIN_RULES } from "../settings/login-rules";
import { getClubStore } from "../store/instance";
import { getAuthStore } from "./instance";
import type { LoginDeps } from "./login";
import { getMailer } from "./mail";
import { getStaffLogins } from "./staff-list";

/** Everything the sign-in needs on the running server: the club's records, the keys, who sends email, who is staff, and the rules. */
export async function getLoginDeps(): Promise<LoginDeps> {
  return { club: await getClubStore(), auth: getAuthStore(), mailer: getMailer(), staff: getStaffLogins(), rules: LOGIN_RULES };
}
