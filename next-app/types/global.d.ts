// Allow the <ion-icon> web component (ionicons) as a valid JSX element,
// and type the lightweight shapes we pass around the app.

import type React from 'react';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'ion-icon': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        name?: string;
      };
    }
  }
}

// A work-log file's metadata as returned by GET /api/worklogs.
export interface WorklogMeta {
  rel: string;
  date: string | null;
  mtime: number;
  count: number;
  hours: number;
  valid: boolean;
  pushed?: boolean;
}

export {};
