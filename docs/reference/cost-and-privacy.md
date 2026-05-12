# Cost And Privacy

ODIN Sentinel does not provide inference and does not host a backend. Users pay
for their own harnesses, model providers, and local inference hardware.

## Network And Telemetry Boundary

Normal MCP operation is local stdio:

```text
MCP client <-> local stdio process <-> bundled protocol files
```

No network call is required for normal protocol reads, validation tools, startup
packets, delegation packets, or closeout checklists.

ODIN Sentinel includes optional telemetry/session-report helper tools. They are
user-invoked, redaction-oriented, and should not be described as automatic
collection. Do not claim "no telemetry" without the qualifier that telemetry is
not automatic and requires an explicit tool call/configured destination.

## Secret Handling

Do not paste API keys, OAuth material, tokens, or passwords into docs/prompts.
Ask whether providers are configured through Doppler, 1Password CLI,
environment variables, direnv, mise, or dotenv-style files. Verify status by
name/count/status only, never by printing secret values.

Beginner-safe wording: "Please make sure this tool is signed in or configured
outside the chat. If it is not, we can pause, use a different harness, or keep
that role slot empty." Do not ask the user to reveal where the secret value is
stored unless they volunteer a non-secret path or tool name.

## Local Inference

Endpoint reachability is not enough. A local model is ready only if it returns
visible content within the session timeout and does not return only
`reasoning_content`.
