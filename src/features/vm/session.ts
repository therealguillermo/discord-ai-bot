import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client, type ClientChannel, type SyncHostVerifier } from "ssh2";
import { config } from "../../config.js";
import { UserError } from "../types.js";
import { shQuote } from "./risk.js";

const CONNECT_TIMEOUT_MS = 20_000;
const OUTPUT_CAP = 16_000;

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

class VmSession {
  private client: Client | null = null;
  private pending: Promise<Client> | null = null;
  private loggedFingerprint = false;

  async exec(script: string, timeoutMs: number): Promise<ExecResult> {
    const remote = `bash -lc ${shQuote(script)}`;
    try {
      return await this.execOn(await this.acquire(), remote, timeoutMs);
    } catch (err) {
      if (err instanceof UserError) throw err;
      this.drop();
      return await this.execOn(await this.acquire(), remote, timeoutMs);
    }
  }

  close(): void {
    this.client?.end();
    this.client = null;
  }

  private drop(): void {
    this.client?.end();
    this.client = null;
  }

  private acquire(): Promise<Client> {
    if (this.client) return Promise.resolve(this.client);
    if (!this.pending) {
      this.pending = this.connect().finally(() => {
        this.pending = null;
      });
    }
    return this.pending;
  }

  private async connect(): Promise<Client> {
    const vm = config.vm;
    if (!vm) throw new UserError("The Oracle VM is not configured.");
    let privateKey: Buffer;
    try {
      privateKey = await readFile(vm.keyPath);
    } catch {
      throw new UserError(
        `Could not read the VM private key at ${vm.keyPath}. Export an OpenSSH key from PuTTYgen (Conversions → Export OpenSSH key).`,
      );
    }
    const hostVerifier: SyncHostVerifier = (key) => {
      const fingerprint = createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
      const expected = vm.fingerprint?.replace(/^SHA256:/, "").replace(/=+$/, "");
      if (expected) return fingerprint === expected;
      if (!this.loggedFingerprint) {
        this.loggedFingerprint = true;
        console.log(`[vm] Oracle host key SHA256:${fingerprint}`);
      }
      return true;
    };
    const conn = new Client();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        conn.end();
        reject(new UserError(`SSH to the Oracle VM at ${vm.host}:${vm.port} timed out.`));
      }, CONNECT_TIMEOUT_MS);
      conn.once("ready", () => {
        clearTimeout(timer);
        resolve();
      });
      conn.once("error", (err) => {
        clearTimeout(timer);
        reject(loginError(err, vm.host, vm.port));
      });
      conn.connect({
        host: vm.host,
        port: vm.port,
        username: vm.user,
        privateKey,
        passphrase: vm.passphrase,
        readyTimeout: CONNECT_TIMEOUT_MS,
        keepaliveInterval: 15_000,
        keepaliveCountMax: 4,
        hostVerifier,
      });
    });
    const drop = () => {
      if (this.client === conn) this.client = null;
    };
    conn.on("end", drop);
    conn.on("close", drop);
    conn.on("error", drop);
    this.client = conn;
    return conn;
  }

  private execOn(conn: Client, remote: string, timeoutMs: number): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      conn.exec(remote, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(collect(stream, timeoutMs));
      });
    });
  }
}

function collect(stream: ClientChannel, timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let exitCode = 0;
    let timedOut = false;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? 124 : exitCode,
        stdout,
        stderr,
        timedOut,
        stdoutTruncated,
        stderrTruncated,
      });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        stream.signal("TERM");
      } catch {
        // The channel may already be gone.
      }
      stream.close();
      finish();
    }, timeoutMs);
    stream.on("data", (chunk: Buffer) => {
      const next = stdout + chunk.toString("utf8");
      if (next.length > OUTPUT_CAP) stdoutTruncated = true;
      stdout = next.slice(0, OUTPUT_CAP);
    });
    stream.stderr.on("data", (chunk: Buffer) => {
      const next = stderr + chunk.toString("utf8");
      if (next.length > OUTPUT_CAP) stderrTruncated = true;
      stderr = next.slice(0, OUTPUT_CAP);
    });
    stream.on("exit", (code: number | null) => {
      if (typeof code === "number") exitCode = code;
    });
    stream.on("close", () => finish());
  });
}

function loginError(err: Error, host: string, port: number): Error {
  const message = err.message || String(err);
  if (/authentication methods failed|all configured authentication/i.test(message)) {
    return new UserError("SSH login to the Oracle VM failed. Check VM_SSH_USER and the OpenSSH private key.");
  }
  if (/ENOTFOUND|ECONNREFUSED|EHOSTUNREACH|ETIMEDOUT|timed out/i.test(message)) {
    return new UserError(`Could not reach the Oracle VM at ${host}:${port}. ${message}`);
  }
  return err;
}

export const vmSession = new VmSession();
