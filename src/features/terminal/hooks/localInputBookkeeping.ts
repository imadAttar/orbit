/** Local title bookkeeping, never a PTY transform or a terminal/chat emulator.
 * Keep only bounded text and parser state across xterm onData boundaries.
 * Incomplete control strings are discarded until terminated (or disposal),
 * never flushed as user text. No control payload is retained.
 */
export class LocalInputBookkeeping {
  private text = "";
  private state: "text" | "escape" | "intermediate" | "csi" | "ss3" | "string" = "text";
  private csi = "";
  private stringEscape = false;
  private osc = false;
  private mouseBytes = 0;
  private pasting = false;

  feed(data: string): string[] {
    const submitted: string[] = [];
    let offset = 0;
    let segmentStart = 0;
    for (const char of data) {
      offset += char.length;
      if (this.mouseBytes > 0) { this.mouseBytes--; continue; }
      if (this.state === "string") {
        if (char === "\x9c" || this.osc && char === "\x07" || this.stringEscape && char === "\\") {
          this.state = "text";
        }
        this.stringEscape = char === "\x1b";
        continue;
      }
      if (char === "\x1b") { this.state = "escape"; continue; }
      if (char === "\x9b") { this.state = "csi"; this.csi = ""; continue; }
      if ("\x90\x98\x9d\x9e\x9f".includes(char)) {
        this.state = "string"; this.osc = char === "\x9d"; this.stringEscape = false;
        continue;
      }
      if (this.state === "escape") {
        this.csi = "";
        if (char === "[") this.state = "csi";
        else if (char === "O") this.state = "ss3";
        else if ("]PX^_".includes(char)) {
          this.state = "string"; this.osc = char === "]"; this.stringEscape = false;
        } else this.state = char >= "\x20" && char <= "\x2f" ? "intermediate" : "text";
        continue;
      }
      if (this.state === "intermediate") {
        if (char < "\x20" || char > "\x2f") this.state = "text";
        continue;
      }
      if (this.state === "csi" || this.state === "ss3") {
        if (char >= "\x40" && char <= "\x7e") {
          if (this.state === "csi") {
            if ((this.csi === "200" || this.csi === "201") && char === "~") {
              this.pasting = this.csi === "200";
              segmentStart = offset;
            }
            if (this.csi === "" && char === "M") this.mouseBytes = 3;
          }
          this.state = "text";
          this.csi = "";
        } else if (char >= "\x20" && char <= "\x3f") {
          // Only paste delimiters need retaining. Oversized controls stay
          // discarded until their final byte, without unbounded buffering.
          this.csi = this.csi.length < 4 ? this.csi + char : "invalid";
        } else {
          this.state = "text";
          this.csi = "";
        }
        continue;
      }
      // Only a standalone Enter segment (callback or paste-delimiter boundary)
      // submits; unbracketed multi-character paste keeps its newlines as text.
      if (!this.pasting && data.length - segmentStart === 1 && (char === "\r" || char === "\n")) {
        submitted.push(this.text.trim());
        this.text = "";
      } else if (char === "\x03" || char === "\x15") {
        this.text = "";
      } else if (char === "\x7f" || char === "\b") {
        this.text = this.text.slice(0, -1);
      } else if (char === "\n" || char === "\t" || char >= " " && !(char >= "\x7f" && char <= "\x9f")) {
        this.text = (this.text + char).slice(0, 4096);
      }
    }
    return submitted;
  }
}
