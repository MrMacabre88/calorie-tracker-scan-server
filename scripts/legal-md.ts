// Prints the privacy policy (or `disclaimer`) as Markdown with the placeholder email.
import { CONTACT_EMAIL_PLACEHOLDER, HEALTH_DISCLAIMER, PRIVACY_POLICY, renderMarkdown } from "../server/legal";
const which = process.argv[2] === "disclaimer" ? HEALTH_DISCLAIMER : PRIVACY_POLICY;
process.stdout.write(renderMarkdown(which, CONTACT_EMAIL_PLACEHOLDER));
