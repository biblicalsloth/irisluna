import { getSupportedMimeType } from "./mime";

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

export class AudioRecorder {
  private mr: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private startedAt = 0;
  private mimeType = "";

  async start(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.mimeType = getSupportedMimeType();
    this.chunks = [];
    this.mr = new MediaRecorder(stream, this.mimeType ? { mimeType: this.mimeType } : undefined);
    this.mr.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.mr.start(250);
    this.startedAt = Date.now();
  }

  stop(): Promise<RecordingResult> {
    return new Promise((resolve, reject) => {
      if (!this.mr) return reject(new Error("Recorder not started"));
      const durationMs = Date.now() - this.startedAt;
      this.mr.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mimeType || "audio/webm" });
        this.mr?.stream.getTracks().forEach((t) => t.stop());
        resolve({ blob, mimeType: this.mimeType, durationMs });
      };
      this.mr.stop();
    });
  }

  cancel(): void {
    if (!this.mr) return;
    this.mr.ondataavailable = null;
    this.mr.onstop = null;
    this.mr.stop();
    this.mr.stream.getTracks().forEach((t) => t.stop());
    this.mr = null;
    this.chunks = [];
  }

  get durationMs() {
    return this.startedAt ? Date.now() - this.startedAt : 0;
  }
}
