import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { authService } from '../services/authService.js';
import { domainEvents } from './domainEvents.js';

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim().split(/=(.*)/s)).filter(([key]) => key).map(([key, value]) => [decodeURIComponent(key), decodeURIComponent(value ?? '')]));
}

export function canUseAdminSocket(user) {
  return Boolean(user && (user.nivel === 'admin' || user.permissoes?.includes('pedidos.listar')));
}

export const notificationRoom = (userId) => `usuario:${userId}`;

export function isSocketOriginAllowed(origin) {
  if (!origin) return env.NODE_ENV !== 'production';
  return env.allowedOrigins.includes(origin);
}

async function authenticateSocket(socket) {
  const origin = socket.handshake?.headers?.origin ?? socket.request?.headers?.origin;
  if (!isSocketOriginAllowed(origin)) throw new Error('Origem nao autorizada');
  const cookies = parseCookies(socket.request?.headers?.cookie);
  const accessToken = cookies.ls_access;
  const user = await authService.authenticate(accessToken);
  if (!canUseAdminSocket(user)) throw new Error('Sem permissao');
  return { user, accessToken };
}

export async function revalidateAdminSocket(socket) {
  try {
    const user = await authService.authenticate(socket.data.accessToken);
    if (!canUseAdminSocket(user)) throw new Error('Sem permissao');
    socket.data.user = user;
    return true;
  } catch {
    socket.leave('pedidos');
    if (socket.data.user?.id != null) socket.leave(notificationRoom(socket.data.user.id));
    socket.disconnect(true);
    return false;
  }
}

export function scheduleTokenExpiry(socket, { revalidate = revalidateAdminSocket, now = Date.now } = {}) {
  const payload = jwt.decode(socket.data.accessToken);
  const delay = payload?.exp ? Math.max(0, payload.exp * 1000 - now() + 100) : 0;
  const timer = setTimeout(() => revalidate(socket), Math.min(delay, 2147483647));
  timer.unref?.();
  socket.once('disconnect', () => clearTimeout(timer));
  return timer;
}

export function startAdminSocketRevalidation(admin, {
  intervalMs = env.SOCKET_REVALIDATE_MS,
  revalidate = revalidateAdminSocket,
} = {}) {
  const timer = setInterval(() => {
    for (const socket of admin.sockets.values()) void revalidate(socket);
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

export function attachSocket(server) {
  const io = new Server(server, { cors: { origin: env.allowedOrigins, credentials: true } });
  const admin = io.of('/admin');
  admin.use(async (socket, next) => {
    try {
      const authenticated = await authenticateSocket(socket);
      socket.data.user = authenticated.user;
      socket.data.accessToken = authenticated.accessToken;
      next();
    } catch {
      next(new Error('Nao autorizado'));
    }
  });
  admin.on('connection', (socket) => {
    socket.join('pedidos');
    socket.join(notificationRoom(socket.data.user.id));
    scheduleTokenExpiry(socket);
  });

  const stopRevalidation = startAdminSocketRevalidation(admin);

  const publico = io.of('/publico');
  const handlers = {
    novo_pedido_recebido: (payload) => admin.to('pedidos').emit('novo_pedido_recebido', payload),
    pedido_atualizado: (payload) => admin.to('pedidos').emit('pedido_atualizado', payload),
    impressao_disponivel: (payload) => admin.to('pedidos').emit('impressao_disponivel', payload),
    loja_atualizada: (payload) => admin.to('pedidos').emit('loja_atualizada', payload),
    notificacao_recebida: ({ usuario_id: userId, ...payload }) => {
      if (userId != null) admin.to(notificationRoom(userId)).emit('notificacao_recebida', payload);
    },
    status_loja_alterado: (payload) => publico.emit('status_loja_alterado', payload),
    auth_access_revoked: ({ usuario_id: userId, session_id: sessionId }) => {
      for (const socket of admin.sockets.values()) {
        if ((userId != null && String(socket.data.user?.id) === String(userId)) || (sessionId && socket.data.user?.sessionId === sessionId)) {
          socket.leave('pedidos');
          socket.leave(notificationRoom(socket.data.user?.id));
          socket.disconnect(true);
        }
      }
    },
  };
  Object.entries(handlers).forEach(([event, handler]) => domainEvents.on(event, handler));
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    stopRevalidation();
    Object.entries(handlers).forEach(([event, handler]) => domainEvents.off(event, handler));
  };
  server.once('close', cleanup);
  return io;
}
