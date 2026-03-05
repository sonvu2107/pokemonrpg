import { useState } from 'react'
import Modal from './Modal'

export default function ComingSoonModal({ isOpen, onClose, featureName }) {
    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Tính năng chưa cập nhật"
            maxWidth="sm"
        >
            <div className="flex flex-col items-center justify-center p-6 text-center">
                {/* Snorlax sprite from PokeAPI */}
                <div className="relative mb-6">
                    <img
                        src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/143.png"
                        alt="Snorlax"
                        className="w-40 h-40 object-contain drop-shadow-xl z-10 relative"
                    />
                    <div className="absolute top-0 right-0 animate-bounce delay-75">
                        <span className="text-2xl font-bold text-slate-400 drop-shadow-md">Z</span>
                    </div>
                    <div className="absolute -top-4 right-4 animate-bounce delay-150">
                        <span className="text-3xl font-bold text-slate-400 drop-shadow-md">z</span>
                    </div>
                    <div className="absolute -top-8 right-8 animate-bounce delay-300">
                        <span className="text-4xl font-bold text-slate-400 drop-shadow-md">z</span>
                    </div>
                </div>

                <h4 className="text-xl font-black text-blue-800 mb-3 drop-shadow-sm uppercase">
                    {featureName || 'Tính năng này'} chưa ra mắt!
                </h4>

                <p className="text-sm text-slate-600 mb-6 font-medium leading-relaxed bg-blue-50 p-3 rounded-lg border border-blue-100">
                    Snorlax đang ngủ khò khè chắn ngang con đường dẫn đến tính năng này.
                    <br /><br />
                    Các lập trình viên đang thổi <span className="text-blue-700 font-bold">Poké Flute</span> để đánh thức nó. Bạn vui lòng quay lại sau nhé!
                </p>

                <button
                    onClick={onClose}
                    className="
                        px-8 py-2.5 
                        bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600
                        text-white font-bold text-lg rounded-full 
                        shadow-lg shadow-blue-500/30 
                        transition-all active:scale-95
                        flex items-center gap-2
                    "
                >
                    <img
                        src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/poke-ball.png"
                        alt="Pokeball"
                        className="w-5 h-5 pixelated"
                    />
                    Đã hiểu
                </button>
            </div>
        </Modal>
    )
}
