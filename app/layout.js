export const metadata = {
  title: "Restaurant Dashboard",
  description: "ระบบบริหารร้านอาหาร",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
