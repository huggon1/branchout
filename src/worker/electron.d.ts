export {};
declare global {
  namespace NodeJS {
    interface Process {
      parentPort?: {
        on(
          event: "message",
          listener: (event: { data: unknown }) => void,
        ): void;
        postMessage(message: unknown): void;
      };
    }
  }
}
