import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import which from "which";

let log!: vscode.LogOutputChannel;

let languageClient: Promise<LanguageClient | undefined> =
  Promise.resolve(undefined);

function getConfig() {
  const config = vscode.workspace.getConfiguration("varlink.languageServer");
  return {
    enabled: config.get<boolean>("enabled", true),
    path: config.get<string>("path", ""),
  };
}

async function spawnClient(): Promise<LanguageClient | undefined> {
  const { enabled, path } = getConfig();
  if (!enabled) {
    return undefined;
  }

  const resolved = await which(path === "" ? "varlink-language-server" : path, {
    nothrow: true,
  });

  if (resolved === null) {
    if (path === "") {
      log.debug("Default language server not on $PATH");
    } else {
      vscode.window.showWarningMessage(
        `Configured language server not found: ${path}`,
      );
    }

    return undefined;
  }

  const client = new LanguageClient(
    "varlink-language-server",
    "Varlink Language Server",
    { command: resolved },
    { documentSelector: [{ language: "varlink" }] },
  );

  try {
    log.info("Starting language server");
    await client.start();
    log.info("Language server started");
    return client;
  } catch (err) {
    log.error(`Cannot start language server: ${err}`);
    vscode.window.showWarningMessage(`Cannot start language server: ${err}`);
    return undefined;
  }
}

async function chain(what: "start" | "stop" | "restart") {
  let wasRunning = false;
  languageClient = languageClient.then(async (prev) => {
    if (prev === undefined) {
      switch (what) {
        case "start":
        case "restart":
          return await spawnClient();
        case "stop":
          return undefined;
      }
    } else {
      wasRunning = true;
      switch (what) {
        case "start":
          return prev;
        case "restart":
        case "stop":
          log.info("Stopping language server");
          await prev.dispose();
          log.info("Language server stopped");
          return what === "restart" ? await spawnClient() : undefined;
      }
    }
  });

  let next = await languageClient;
  return { wasRunning, next };
}

export async function activate(context: vscode.ExtensionContext) {
  log = vscode.window.createOutputChannel("Varlink", { log: true });
  context.subscriptions.push(log);

  let next = chain("start");

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration("varlink.languageServer")) {
        await chain("restart");
      }
    }),

    vscode.commands.registerCommand(
      "varlink.restartLanguageServer",
      async () => {
        let { next, wasRunning } = await chain("restart");
        if (next) {
          vscode.window.showInformationMessage(
            wasRunning
              ? "Varlink: Language server restarted."
              : "Varlink: Language server started.",
          );
        }
      },
    ),
  );

  await next;
}

export async function deactivate() {
  await chain("stop");
}
