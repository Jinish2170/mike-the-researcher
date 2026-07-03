import { ProgressEvent } from '../types';

export class ResearchError extends Error {
  constructor(
    message: string,
    public readonly phase: ProgressEvent['phase'],
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'ResearchError';
  }
}
