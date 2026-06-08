export default function Home() {
  return (
    <main
      style={{
        width: "100vw",
        height: "100dvh",
        margin: 0,
        overflow: "hidden",
        background: "#08080e",
      }}
    >
      <iframe
        title="GymLog"
        src="/gymlog-classic.html"
        style={{
          width: "100%",
          height: "100%",
          border: 0,
          display: "block",
          background: "#08080e",
        }}
      />
    </main>
  );
}
