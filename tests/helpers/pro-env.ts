// Imported first by tests that exercise the Pro endpoints through server/index.ts.
// Fake values only; Gemini is stubbed so nothing leaves the machine.
process.env.NODE_ENV = "test";
process.env.GEMINI_API_KEY = "fake-test-key";
process.env.APP_TOKEN = "fake-app-token";
process.env.COACH_LIMIT_PER_IP_DAY = "3";
process.env.DAILY_SCAN_CAP = "100";
