<div align="center">

# 📞 Звонилка

**Минималистичное веб-приложение для аудио и видеозвонков**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org/)
[![Fastify](https://img.shields.io/badge/Fastify-5.0-white)](https://fastify.io/)

[Демо](#демо) • [Возможности](#возможности) • [Установка](#установка) • [Архитектура](#архитектура) • [API](#api)

</div>

---

## Возможности

### Основные функции
- **Аудиозвонки** — кристально чистый звук через WebRTC
- **Демонстрация экрана** — делитесь экраном с участниками
- **Запись встреч** — сохраняйте записи локально
- **Приглашение по ссылке** — отправьте ссылку или 6-значный код
- **Подтверждение хостом** — контроль кто может присоединиться

### Масштабирование
- **P2P режим** — до 10-15 участников (mesh-топология)
- **SFU режим** — до 30 участников (mediasoup)

### Дизайн
- Минималистичный Apple-style интерфейс
- Адаптивная вёрстка для мобильных устройств
- Поддержка iOS (Web Share API для сохранения записей)

---

## Технологии

### Frontend
| Технология | Назначение |
|------------|------------|
| Next.js 15 | React фреймворк |
| TypeScript | Типизация |
| Tailwind CSS | Стилизация |
| PeerJS | WebRTC P2P соединения |
| mediasoup-client | SFU клиент |

### Backend
| Технология | Назначение |
|------------|------------|
| Fastify | HTTP сервер |
| @fastify/websocket | WebSocket поддержка |
| PeerJS Server | Сигнальный сервер P2P |
| mediasoup | SFU сервер |

---

## Архитектура

```
┌─────────────────────────────────────────────────────────────────┐
│                         Клиенты                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐     │
│   │ Client  │    │ Client  │    │ Client  │    │ Client  │     │
│   │    1    │    │    2    │    │    3    │    │   ...   │     │
│   └────┬────┘    └────┬────┘    └────┬────┘    └────┬────┘     │
│        │              │              │              │           │
└────────┼──────────────┼──────────────┼──────────────┼───────────┘
         │              │              │              │
         ▼              ▼              ▼              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Backend Server                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────────────┐         ┌─────────────────┐              │
│   │   PeerJS Server │         │    mediasoup    │              │
│   │   (Signaling)   │         │   (SFU Router)  │              │
│   │                 │         │                 │              │
│   │  • P2P режим    │         │  • До 30 чел.   │              │
│   │  • До 15 чел.   │         │  • WebRTC SFU   │              │
│   └─────────────────┘         └─────────────────┘              │
│                                                                 │
│   ┌─────────────────┐         ┌─────────────────┐              │
│   │   Room Manager  │         │   WebSocket     │              │
│   │                 │         │   Signaling     │              │
│   │  • Создание     │         │                 │              │
│   │  • Подтверждение│         │  • SFU события  │              │
│   │  • Участники    │         │  • Синхронизация│              │
│   └─────────────────┘         └─────────────────┘              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Режимы работы

#### P2P (Mesh) — до 15 участников
```
    Client 1 ◄────────► Client 2
        ▲                   ▲
        │                   │
        │                   │
        ▼                   ▼
    Client 3 ◄────────► Client 4
```
Каждый клиент соединён напрямую со всеми остальными.

#### SFU — до 30 участников
```
                    ┌─────────────┐
    Client 1 ──────►│             │◄────── Client 2
                    │  mediasoup  │
    Client 3 ──────►│   Router    │◄────── Client 4
                    │             │
    Client 5 ──────►│             │◄────── ...
                    └─────────────┘
```
Все медиапотоки проходят через сервер.

---

## Установка

### Требования
- Node.js 18+
- npm или yarn

### Быстрый старт

```bash
# Клонирование репозитория
git clone https://github.com/pixelligue/zvonizvonu.git
cd zvonizvonu

# Установка зависимостей
cd backend && npm install
cd ../frontend && npm install

# Запуск в режиме разработки
# Терминал 1 - Backend
cd backend && npm run dev

# Терминал 2 - Frontend
cd frontend && npm run dev
```

Откройте http://localhost:3000

### Переменные окружения

#### Backend (`backend/.env`)
```env
PORT=5005
FRONTEND_URL=http://localhost:3000
```

#### Frontend (`frontend/.env.local`)
```env
NEXT_PUBLIC_API_URL=http://localhost:5005
NEXT_PUBLIC_WS_URL=ws://localhost:5005/sfu
NEXT_PUBLIC_PEER_HOST=localhost
NEXT_PUBLIC_PEER_PORT=5005
NEXT_PUBLIC_PEER_PATH=/peerjs
```

---

## Структура проекта

```
zvonilka/
├── backend/
│   ├── src/
│   │   ├── index.ts              # Точка входа
│   │   ├── routes/
│   │   │   ├── rooms.ts          # API комнат
│   │   │   └── sfu.ts            # WebSocket SFU
│   │   └── services/
│   │       └── mediasoup.ts      # SFU сервис
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx          # Главная страница
│   │   │   └── room/[code]/
│   │   │       └── page.tsx      # Страница комнаты
│   │   ├── components/
│   │   │   ├── icons/            # SVG иконки
│   │   │   ├── room/             # Компоненты комнаты
│   │   │   └── MicLevel.tsx      # Индикатор микрофона
│   │   └── hooks/
│   │       ├── useMicrophone.ts  # Хук микрофона
│   │       ├── useRecorder.ts    # Хук записи
│   │       ├── usePeer.ts        # Хук P2P
│   │       └── useSFU.ts         # Хук SFU
│   ├── package.json
│   └── tsconfig.json
│
└── README.md
```

---

## API

### REST Endpoints

#### Комнаты
| Метод | Endpoint | Описание |
|-------|----------|----------|
| `POST` | `/api/rooms` | Создать комнату |
| `GET` | `/api/rooms/:code` | Получить информацию о комнате |
| `POST` | `/api/rooms/:code/join` | Запросить присоединение |
| `POST` | `/api/rooms/:code/approve` | Подтвердить участника (хост) |
| `POST` | `/api/rooms/:code/reject` | Отклонить участника (хост) |
| `DELETE` | `/api/rooms/:code/leave/:oderId` | Покинуть комнату |

#### SFU
| Метод | Endpoint | Описание |
|-------|----------|----------|
| `GET` | `/api/sfu/:code/capabilities` | RTP capabilities комнаты |

### WebSocket Events (SFU)

#### Клиент → Сервер
| Событие | Данные | Описание |
|---------|--------|----------|
| `join` | `{ roomCode, peerId, name }` | Присоединиться к комнате |
| `createTransport` | `{}` | Создать WebRTC транспорт |
| `connectTransport` | `{ transportId, dtlsParameters }` | Подключить транспорт |
| `produce` | `{ transportId, kind, rtpParameters }` | Начать отправку медиа |
| `consume` | `{ transportId, producerId, rtpCapabilities }` | Начать получение медиа |
| `getProducers` | `{}` | Получить список producers |

#### Сервер → Клиент
| Событие | Данные | Описание |
|---------|--------|----------|
| `joined` | `{ rtpCapabilities, participants }` | Успешное подключение |
| `newProducer` | `{ peerId, producerId, name }` | Новый producer |
| `peerJoined` | `{ peerId, name }` | Новый участник |
| `peerLeft` | `{ peerId }` | Участник вышел |
| `producerClosed` | `{ producerId }` | Producer закрыт |

---

## Разработка

### Скрипты

#### Backend
```bash
npm run dev      # Запуск с hot-reload
npm run build    # Сборка
npm run start    # Запуск production
```

#### Frontend
```bash
npm run dev      # Запуск с hot-reload
npm run build    # Сборка
npm run start    # Запуск production
npm run lint     # Проверка кода
```

### Отладка

Для отладки WebRTC соединений используйте:
- Chrome: `chrome://webrtc-internals`
- Firefox: `about:webrtc`

---

## Деплой

### Docker (рекомендуется)

```dockerfile
# Backend
FROM node:18-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --only=production
COPY backend/dist ./dist
EXPOSE 5005
CMD ["node", "dist/index.js"]
```

### Требования к серверу для SFU
- Открытые UDP порты: 40000-49999 (RTC)
- Открытые TCP порты: 5005 (API)
- Минимум 2 CPU cores
- Минимум 2GB RAM

---

## Лицензия

MIT © 2025

---

<div align="center">

**Сделано с ❤️ для простых звонков**

[⬆ Наверх](#-звонилка)

</div>
