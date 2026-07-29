function isDisconnectedRead(error) {
  return (
    error !== null &&
    typeof error === 'object' &&
    error.code === 'ECONNRESET' &&
    error.syscall === 'read'
  );
}

function containDisconnectedRead(error) {
  if (isDisconnectedRead(error)) {
    console.error('[e2e] contained disconnected Web socket (read ECONNRESET)');
    return;
  }

  process.removeListener('uncaughtException', containDisconnectedRead);
  throw error;
}

process.on('uncaughtException', containDisconnectedRead);
