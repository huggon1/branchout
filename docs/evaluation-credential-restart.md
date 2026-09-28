# EV-14 integration credential restart

This document defines the packaged-app acceptance for the [EV-14 scenario](evaluation.md) before its implementation. The fixture uses an isolated app profile and fictional values. Its driver and run record remain in the machine-local evaluation directory.

## Failure modes

| Setup | Failure to expose | Independent observation |
| --- | --- | --- |
| Save a fictional Telegram bot token in Settings, then restart the packaged app | Startup reads the saved bot token through Electron Safe Storage and triggers the login-keychain prompt | The owner-only local JSON contains the saved token; Settings reports configured after restart; the test's legacy-cipher guard records zero calls and the operator records native prompt observation. |
| Save a local bot-token JSON beside malformed legacy ciphertext | Startup prefers the legacy file or rewrites the valid JSON | Settings stays configured and the JSON bytes remain unchanged after restart. |
| Queue a fictional Xiaohongshu share token in Telegram and forwarding state, then restart | Recovery decrypts queued tokens through Safe Storage or loses them | The owner-only state files retain the local token fields across restart; startup reaches the desktop window with the legacy-cipher guard armed. |
| Start with a valid legacy encrypted bot token or queued share token | Migration loses the value or erases historical bytes | One legacy decrypt yields a valid owner-only local representation; the original encrypted file or pre-migration state snapshot remains byte-for-byte available. A second restart reads the local representation. |
| Start with malformed local JSON or legacy ciphertext | Startup silently treats corrupt data as an empty configuration | Startup fails with a specific credential or migration error and preserves the original file bytes. |

## Fixture sequence

1. Launch the packaged executable with isolated `BRANCHOUT_TEST_DATA`, a loopback-blocked Telegram network path, and an evaluation guard that fails every routine Safe Storage read or write.
2. Use the Settings UI to save a fictional bot token. Check renderer redaction, local JSON content, owner-only mode, and a screen capture.
3. Close and restart the same isolated profile. Check configured state and a successful desktop window. Add invalid legacy bot ciphertext beside the valid JSON and repeat.
4. Populate valid fictional queued-share records in the two owner-only state files; restart and check their local token fields and completed startup. The records carry no real Xiaohongshu account.
5. Run legacy-migration cases separately with an operator-provided ciphertext made under that app identity. Capture the exact pre-migration bytes, migrated local value, original-byte preservation, and second-restart behavior.

The automatic fixture records file permissions, JSON fields, restart status, and legacy-cipher guard calls. The native macOS prompt observation is a separate human field in the EV-14 review artifact because a Playwright renderer capture cannot see system-owned password dialogs. A fixture pass and a human “no prompt observed” result form the release acceptance for the new local-file path.

The queued-token field keeps its historical `xhsAccessTokenCiphertext` name for persisted-state compatibility. New values use a readable `local-v1:` prefix followed by the fictional or user-supplied token. A state migration rewrites old encrypted values to that format while retaining a byte-for-byte `.legacy` snapshot of the original state file.
