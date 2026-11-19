# Aitiarch on macOS

Use a local checkout, Node 24 or newer, and an empty test project folder. Keep your own notes closed. These steps do not require an AI request or a provider sign-in.

1. Add the local Aitiarch marketplace in either host. Use the absolute path to the checkout.
   - **Claude Code** — run `/plugin marketplace add <checkout>`, then `/plugin install aitiarch@aitiarch`. Open the empty test project and run `/aitiarch:aitiarch`.
   - **Codex** — run `codex plugin marketplace add "<checkout>"`. In the Codex Plugins Directory, choose **Aitiarch (experimental)** and install **Aitiarch**. Open the empty test project and ask to start Aitiarch.
2. If the plugin build fails, record which step failed. To verify a source build separately, run `npm --prefix ui ci` and then `npm --prefix ui run build` from the checkout. If you are repairing the plugin-managed build, use the app install folder shown by setup in place of the checkout.
3. In the browser, check that the test notebook opens with AI off, then open **AI settings → Setup**. Check which installed CLIs were found. In a Git project, look for the prompt before approving private ignore rules. Quit and launch again to see whether setup reuses the build and notebook. Keep chat unsent.
4. From the built checkout, run `node tester/mac-doctor.mjs /tmp/aitiarch-mac-report.json`. Use a fresh output filename on each run. The script runs only `doctor` and `doctor --models` in JSON mode with a temporary Aitiarch config. It writes selected status fields and timings even if Doctor reports failed prerequisites. It drops paths, raw CLI output and free-form text.
5. Review and send the JSON report, the plugin host and version, and a short note on what opened or failed. Add whether a CLI came from Homebrew, npm or a standalone install and whether you use a custom config location. Omit account details, absolute paths, raw logs and screenshots of personal data.

A passing report checks discovery, build prerequisites and model metadata. The browser steps check installation and AI-off startup. Provider login and real requests are outside this test.
