import './globals.css';
import './dashboard.css';
import './shadcn.css';
import Shell from '@/components/Shell';

export const metadata = {
  title: 'Work-log Pusher · Monarch',
  description: 'Push ActiveCollab work-logs and overtime expenses.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <script type="module" src="https://cdn.jsdelivr.net/npm/ionicons@7.4.0/dist/ionicons/ionicons.esm.js" />
        <script noModule src="https://cdn.jsdelivr.net/npm/ionicons@7.4.0/dist/ionicons/ionicons.js" />
      </head>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
