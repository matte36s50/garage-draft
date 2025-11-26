import "./globals.css";

export const metadata = {
  title: "Auction Admin Portal",
  description: "Fantasy Football Auction Administration",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
