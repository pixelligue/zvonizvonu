'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5005';

export default function Home() {
  const router = useRouter();
  const [roomCode, setRoomCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [largeMeeting, setLargeMeeting] = useState(false);

  const createRoom = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/rooms`, { method: 'POST' });
      const data = await res.json();
      const params = largeMeeting ? 'host=true&sfu=true' : 'host=true';
      router.push(`/room/${data.code}?${params}`);
    } catch {
      setError('Не удалось создать комнату');
    } finally {
      setLoading(false);
    }
  };

  const joinRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomCode.trim()) return;

    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/rooms/${roomCode.toUpperCase()}`);
      if (!res.ok) {
        setError('Комната не найдена');
        return;
      }
      router.push(`/room/${roomCode.toUpperCase()}`);
    } catch {
      setError('Не удалось подключиться');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f5f5f7]">
      <main className="flex flex-col items-center gap-10 p-8">
        {/* Логотип */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-16 h-16 bg-gradient-to-br from-green-400 to-green-600 rounded-2xl flex items-center justify-center shadow-lg">
            <PhoneIcon />
          </div>
          <h1 className="text-3xl font-semibold text-gray-900 tracking-tight">
            Звонилка
          </h1>
          <p className="text-gray-500 text-base">Простые аудиозвонки</p>
        </div>

        {/* Карточка */}
        <div className="w-80 bg-white/80 backdrop-blur-xl rounded-3xl shadow-xl p-8 space-y-6">
          {/* Переключатель большого митинга */}
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <span className="text-gray-700 text-sm font-medium">Большой митинг</span>
              <p className="text-gray-400 text-xs">До 30 участников</p>
            </div>
            <button
              type="button"
              onClick={() => setLargeMeeting(!largeMeeting)}
              className={`w-11 h-6 rounded-full transition-colors ${largeMeeting ? 'bg-[#34C759]' : 'bg-gray-300'}`}
            >
              <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform mx-0.5 ${largeMeeting ? 'translate-x-5' : ''}`} />
            </button>
          </label>

          <button
            onClick={createRoom}
            disabled={loading}
            className="w-full py-4 bg-[#007AFF] hover:bg-[#0066d6] disabled:bg-gray-300 text-white text-lg font-medium rounded-2xl transition-all active:scale-[0.98]"
          >
            {loading ? 'Создание...' : 'Создать комнату'}
          </button>

          <div className="flex items-center gap-4">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-gray-400 text-sm">или войти</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          <form onSubmit={joinRoom} className="space-y-4">
            <input
              type="text"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              placeholder="Код комнаты"
              maxLength={6}
              className="w-full py-4 px-5 bg-gray-100 text-gray-900 placeholder-gray-400 rounded-2xl border-0 focus:ring-2 focus:ring-[#007AFF] focus:outline-none text-center text-xl tracking-[0.3em] font-medium"
            />
            <button
              type="submit"
              disabled={loading || !roomCode.trim()}
              className="w-full py-4 bg-gray-900 hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 text-white text-lg font-medium rounded-2xl transition-all active:scale-[0.98]"
            >
              Войти
            </button>
          </form>

          {error && (
            <p className="text-red-500 text-center text-sm">{error}</p>
          )}
        </div>
      </main>
    </div>
  );
}

function PhoneIcon() {
  return (
    <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  );
}
