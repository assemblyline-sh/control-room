// @ts-check

/**
 * @typedef {Object} ExplainedError
 * @property {string} title - what happened, in plain words
 * @property {string} hint - what to do next
 * @property {string} details - the original text
 */

/**
 * Most specific first: ssh's text is wrapped in our own ("ssh to x (x) failed: …").
 * @type {[RegExp, (computer: string, match: RegExpMatchArray) => { title: string, hint: string }][]}
 */
const RULES = [
  [
    /Host key verification failed/,
    (c) => ({
      title: `This computer hasn't connected to ${c} before`,
      hint: `Run \`ssh ${c}\` once in a terminal and answer yes, then try again.`,
    }),
  ],
  [
    /Permission denied \(/,
    (c) => ({
      title: `${c} didn't accept your SSH key`,
      hint: `\`ssh ${c}\` needs to work in a terminal without a password. Set up a key, then try again.`,
    }),
  ],
  [
    /does not permit you to SSH as user "?([^"\s]+)/,
    (c, m) => ({
      title: `Tailscale doesn't allow the user ${m[1]} on ${c}`,
      hint: `Go back and enter it as \`user@${c}\`, with your user name on that computer.`,
    }),
  ],
  [
    /Could not resolve hostname/,
    (c) => ({
      title: `Couldn't find a computer called ${c}`,
      hint: "Check the spelling, and that you're on the same network.",
    }),
  ],
  [
    /Connection refused/,
    (c) => ({
      title: `${c} isn't accepting SSH connections`,
      hint: "Check that it's on and that SSH is enabled there.",
    }),
  ],
  [
    /timed out|didn't answer within/i,
    (c) => ({
      title: `${c} didn't answer`,
      hint: "Check that it's on, awake and on your network, then try again.",
    }),
  ],
  [
    /node not found on/,
    (c) => ({
      title: `Couldn't find Node on ${c}`,
      hint: "Install Node there and try again, or choose where it is with Other path.",
    }),
  ],
  [
    /Is a directory/,
    () => ({
      title: "That's a folder, not the node program",
      hint: "Enter the path of the file itself, usually ending in /bin/node.",
    }),
  ],
  [
    /Could not run node/,
    () => ({
      title: "Couldn't find Node on this computer",
      hint: "Install Node, then try again.",
    }),
  ],
];

/**
 * An error from a host, in words a newcomer can act on.
 * @param {unknown} err
 * @param {string} computer - the name to call the host by
 * @returns {ExplainedError}
 */
export function explainError(err, computer) {
  const details = String(err);
  for (const [pattern, explain] of RULES) {
    const match = details.match(pattern);
    if (match) return { ...explain(computer, match), details };
  }
  return {
    title: `Something went wrong with ${computer}`,
    hint: "Try again. If it keeps happening, the details say what failed.",
    details,
  };
}
