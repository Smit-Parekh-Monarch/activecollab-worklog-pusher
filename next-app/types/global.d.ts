// Allow the <ion-icon> web component (ionicons) as a valid JSX element,
// and type the lightweight shapes we pass around the app.

import type React from 'react';

type IonIconProps = React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
  name?: string;
};

declare global {
  // global JSX namespace (TS < 19 / classic)
  namespace JSX {
    interface IntrinsicElements {
      'ion-icon': IonIconProps;
    }
  }
}

// React 19 moved the JSX namespace under the React module.
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'ion-icon': IonIconProps;
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
