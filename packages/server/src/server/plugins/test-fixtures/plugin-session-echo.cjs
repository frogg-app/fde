process.on("message", (message) => {
  if (message?.type !== "fde_frame") return;
  process.send?.(message);
});
