import { describe, expect, it } from "vitest";
import { shellRisk } from "./risk.js";
import { buildTmux } from "./tmux.js";

const read = (command: string) => expect(shellRisk(command), command).toBe("read");
const change = (command: string) => expect(shellRisk(command), command).toBe("change");

describe("shell risk", () => {
  it("treats inspection as read-only", () => {
    read("ls -la /var");
    read("pwd");
    read("cat /etc/os-release");
    read("head -n 40 /var/log/messages");
    read("tail -n 20 /var/log/syslog");
    read("grep -n error /var/log/syslog");
    read("find /var/log -name '*.log'");
    read("stat /etc/hostname");
    read("df -h");
    read("du -sh /home");
    read("ps aux");
    read("whoami");
    read("cd /var/log && ls");
    read("ls -la 2>&1");
    read("echo 'hello > world'");
    read("echo '$(rm -rf /)'");
    read("ls $(pwd)");
    read("sudo cat /var/log/syslog");
    read("sudo -n cat /etc/shadow");
    read("journalctl -n 50 --no-pager");
    read("systemctl status nginx");
    read("git status");
    read("git log -n 5 --oneline");
    read("git diff HEAD");
    read("git branch");
    read("ip addr");
    read("ip route");
    read("ss -lntp");
    read("docker ps");
    read("crontab -l");
    read("dpkg -l");
    read("apt list --installed");
    read("sed -n '1,20p' /etc/hosts");
    read("awk '{print $1}' /etc/hosts");
    read("tmux list-sessions");
    read("tmux capture-pane -p -J -t dev:0.0 -S -200");
    read("bash -lc 'ls -la /var'");
  });

  it("treats real changes as changes", () => {
    change("rm -rf /tmp/x");
    change("ls > /tmp/out");
    change("echo hi >> /tmp/out");
    change("cat file | tee /tmp/out");
    change("ls && rm x");
    change("echo $(rm x)");
    change("sudo reboot");
    change("sudo systemctl restart nginx");
    change("systemctl restart nginx");
    change("find . -delete");
    change("find . -exec rm {} +");
    change("sed -i 's/a/b/' file");
    change("git commit -m x");
    change("git branch feature");
    change("git push");
    change("python -c 'print(1)'");
    change("apt install nginx");
    change("mkdir /tmp/new");
    change("chmod 755 script.sh");
    change("tmux new-session -d -s dev");
    change("tmux send-keys -t dev 'rm x' Enter");
    change("tmux send-keys -t dev Enter");
    change("tmux send-keys -t dev C-c");
    change("reboot");
    change("kill 123");
  });

  it("lets a read-only tmux keystroke through and holds every other one", () => {
    read("tmux send-keys -t dev 'ls -la' Enter");
    read("tmux send-keys -t dev 'cd /var && ls' Enter");
    change("tmux send-keys -t dev Up");
    change("tmux send-keys -t dev 'ls' Enter 'rm x' Enter");
  });
});

describe("tmux command builder", () => {
  it("captures a pane as a read", () => {
    const call = buildTmux({ action: "capture", target: "dev:0.0", lines: 50 });
    expect(call.command).toContain("capture-pane");
    expect(shellRisk(call.command)).toBe("read");
  });

  it("types a read-only command without asking, and a write with a confirm", () => {
    const look = buildTmux({ action: "keys", target: "dev", text: "ls -la", keys: ["Enter"] });
    expect(shellRisk(look.command)).toBe("read");
    const remove = buildTmux({ action: "keys", target: "dev", text: "rm -rf /tmp/x", keys: ["Enter"] });
    expect(shellRisk(remove.command)).toBe("change");
    const enter = buildTmux({ action: "keys", target: "dev", keys: ["Enter"] });
    expect(shellRisk(enter.command)).toBe("change");
    const interrupt = buildTmux({ action: "keys", target: "dev", keys: ["C-c"] });
    expect(shellRisk(interrupt.command)).toBe("change");
  });

  it("creates, splits, and kills only as changes", () => {
    expect(shellRisk(buildTmux({ action: "new_session", session: "dev" }).command)).toBe("change");
    expect(shellRisk(buildTmux({ action: "split", target: "dev:0.0", direction: "vertical" }).command)).toBe("change");
    expect(shellRisk(buildTmux({ action: "kill_session", target: "dev" }).command)).toBe("change");
    expect(buildTmux({ action: "new_session", session: "dev" }).command).toContain("new-session");
    expect(buildTmux({ action: "new_session", session: "dev" }).command).toContain("-d");
  });
});
