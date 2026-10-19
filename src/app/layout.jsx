// @ts-check
import "./globals.css";
import "@xterm/xterm/css/xterm.css";

export const metadata = {
  title: "Control Room",
  description: "The factory floor of every Assembly Line factory, on this machine and over SSH",
};

/**
 * @param {{ children: React.ReactNode }} props
 * @returns {React.JSX.Element}
 */
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
