/** Reads only bounded OSC 0/2 title messages; ordinary output is never retained. */
export class ApplicationTitleReader {
  private state: 'text' | 'escape' | 'command' | 'title' | 'end' | 'skip' | 'skip-end' = 'text';
  private command = '';
  private title = '';

  read(chunk: string): string | undefined {
    if (this.state === 'text' && !chunk.includes('\x1b') && !chunk.includes('\x9d')) return;
    let latest: string | undefined;
    for (const char of chunk) {
      if (this.state === 'text') {
        if (char === '\x1b') this.state = 'escape';
        else if (char === '\x9d') this.start();
      } else if (this.state === 'escape') {
        if (char === ']') this.start();
        else if (char !== '\x1b') this.state = 'text';
      } else if (this.state === 'command') {
        if (char === ';') this.state = this.command === '0' || this.command === '2' ? 'title' : 'skip';
        else if (/^[0-9]$/u.test(char) && this.command.length < 4) this.command += char;
        else this.state = 'skip';
      } else if (this.state === 'title') {
        if (char === '\x07' || char === '\x9c') { latest = this.title.trim(); this.reset(); }
        else if (char === '\x1b') this.state = 'end';
        else if (char < ' ' || (char >= '\x7f' && char <= '\x9f') || this.title.length >= 512) { this.title = ''; this.state = 'skip'; }
        else this.title += char;
      } else if (this.state === 'end') {
        if (char === '\\') { latest = this.title.trim(); this.reset(); }
        else { this.title = ''; this.state = 'skip'; }
      } else if (this.state === 'skip') {
        if (char === '\x07' || char === '\x9c') this.reset();
        else if (char === '\x1b') this.state = 'skip-end';
      } else if (this.state === 'skip-end') {
        if (char === '\\' || char === '\x07' || char === '\x9c') this.reset();
        else if (char === ']') this.start();
        else this.state = 'skip';
      }
    }
    return latest;
  }

  private start(): void { this.command = ''; this.title = ''; this.state = 'command'; }
  private reset(): void { this.command = ''; this.title = ''; this.state = 'text'; }
}
