export interface Track {
  id: string;
  title: string;
  /** YouTube/page URL (or search landing URL) — playback pipes this through yt-dlp. */
  pageUrl: string;
  durationSec: number | null;
  requestedBy: string;
}

/** In-memory music queue. Index 0 is next-up (not the currently playing track). */
export class MusicQueue {
  private tracks: Track[] = [];

  get length(): number {
    return this.tracks.length;
  }

  list(): Track[] {
    return [...this.tracks];
  }

  enqueue(track: Track): number {
    this.tracks.push(track);
    return this.tracks.length;
  }

  /** Remove and return the next track, or undefined if empty. */
  shift(): Track | undefined {
    return this.tracks.shift();
  }

  clear(): number {
    const n = this.tracks.length;
    this.tracks = [];
    return n;
  }

  /**
   * Remove by 1-based position. Returns the removed track.
   * Throws if index is out of range.
   */
  remove(index1: number): Track {
    const i = index1 - 1;
    if (!Number.isInteger(index1) || i < 0 || i >= this.tracks.length) {
      throw new RangeError(`Queue position must be between 1 and ${this.tracks.length || 0}.`);
    }
    const [removed] = this.tracks.splice(i, 1);
    return removed!;
  }

  /**
   * Move a track from one 1-based position to another.
   * Throws if either index is out of range.
   */
  move(from1: number, to1: number): Track {
    const from = from1 - 1;
    const to = to1 - 1;
    if (!Number.isInteger(from1) || !Number.isInteger(to1)) {
      throw new RangeError("Queue positions must be whole numbers.");
    }
    if (from < 0 || from >= this.tracks.length || to < 0 || to >= this.tracks.length) {
      throw new RangeError(`Queue positions must be between 1 and ${this.tracks.length}.`);
    }
    const [track] = this.tracks.splice(from, 1);
    this.tracks.splice(to, 0, track!);
    return track!;
  }

  moveToFront(index1: number): Track {
    return this.move(index1, 1);
  }
}
