import assert from "node:assert/strict";
import { test } from "node:test";
import { explainError } from "../src/lib/explain-error.js";

// Real output, captured from ssh and the app.
const cases = [
  ["ssh to box (box) failed: Host key verification failed.", "hasn't connected", "ssh box"],
  ["ssh to box (box) failed: nobody@github.com: Permission denied (publickey).", "didn't accept", "without a password"],
  ['ssh to box (box) failed: tailscale: tailnet policy does not permit you to SSH as user "alex" / Connection closed by 100.69.60.54 port 22', "user alex", "user@box"],
  ["ssh to box (box) failed: ssh: Could not resolve hostname box: nodename nor servname provided, or not known", "called box", "spelling"],
  ["ssh to box (box) failed: ssh: connect to host box port 22: Connection refused", "isn't accepting", "SSH is enabled"],
  ["ssh to box (box) failed: ssh: connect to host 10.255.255.1 port 22: Operation timed out", "didn't answer", "awake"],
  ["box didn't answer within 120s (waiting on sign-in?)", "didn't answer", "awake"],
  ["node not found on box. Set 'node:' for this host in the config to its absolute path", "Node on box", "Install Node"],
  ["Unexpected output from the probe on box: /bin/bash: line 1: /home/a/factory-x: Is a directory", "a folder", "/bin/node"],
  ["Could not run node (node): No such file or directory. Set 'node:' for the local host", "this computer", "Install Node"],
];

for (const [text, title, hint] of cases) {
  test(`explains: ${text.slice(0, 60)}`, () => {
    const e = explainError(text, "box");
    assert.ok(e.title.includes(title), e.title);
    assert.ok(e.hint.includes(hint), e.hint);
    assert.equal(e.details, text);
  });
}

test("anything else keeps its text and still says what to do", () => {
  const e = explainError(new Error("boom"), "box");
  assert.match(e.title, /box/);
  assert.match(e.hint, /Try again/);
  assert.equal(e.details, "Error: boom");
});
