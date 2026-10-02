/** Terminal input for the administrator CLIs (bootstrap, operator). */

/** Reads a line from the terminal without echoing it. Paste works. */
export function promptHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") return finish();
        if (char === "\u0003") return finish(new Error("Avbrutet."));
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    };
    stdout.write(question);
    stdin.setEncoding("utf8");
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

/** Reads one visible line from the terminal. */
export function promptLine(question: string): Promise<string> {
  const { stdin, stdout } = process;
  return new Promise((resolve) => {
    stdout.write(question);
    stdin.setEncoding("utf8");
    stdin.resume();
    stdin.once("data", (chunk: string) => {
      stdin.pause();
      resolve(chunk.split(/\r?\n/, 1)[0] ?? "");
    });
  });
}

/** The first line of piped standard input. */
export async function readPiped(): Promise<string> {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  return input.split(/\r?\n/, 1)[0] ?? "";
}
