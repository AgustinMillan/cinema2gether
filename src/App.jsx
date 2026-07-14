import { useState, useEffect, useRef } from "react";
import Peer from "peerjs";

// Configuración de endpoints unificados en tu propio VPS
const BASE_URL = "https://xhi.alquila110.tech";
const API_URL = `${BASE_URL}/api`;
const STREAM_URL = `${BASE_URL}/stream`;

export default function App() {
  const [username, setUsername] = useState("");
  const [chatColor, setChatColor] = useState("#6366f1");
  const [roomIdInput, setRoomIdInput] = useState("");
  const [isRoomJoined, setIsRoomJoined] = useState(false);

  const [roomId, setRoomId] = useState("");
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");

  // Sincronización y videoteca propia
  const [videoList, setVideoList] = useState([]);
  const [selectedVideo, setSelectedVideo] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");

  const peerRef = useRef(null);
  const connRef = useRef(null);
  const videoRef = useRef(null);
  const chatBottomRef = useRef(null);
  const ignoreVideoEvents = useRef(false);

  useEffect(() => {
    if (chatBottomRef.current) {
      chatBottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Carga la lista de videos desde el VPS
  const fetchVideos = async () => {
    try {
      const response = await fetch(`${API_URL}/videos`);
      if (response.ok) {
        const data = await response.json();
        setVideoList(data);
      }
    } catch (err) {
      console.error("Error al conectar con la videoteca del VPS:", err);
    }
  };

  // Traer los videos disponibles en cuanto el componente se monta
  useEffect(() => {
    fetchVideos();
  }, []);

  const setupConnection = (currentConn) => {
    connRef.current = currentConn;

    currentConn.on("open", () => {
      setMessages((prev) => [
        ...prev,
        { type: "system", text: "¡Conectados! Sincronizando sesión..." },
      ]);

      currentConn.send({
        type: "system",
        text: `${username || "Alguien"} se ha unido a la sala.`,
      });

      // Si soy el Host y ya tengo un video corriendo, se lo inyecto con el timestamp actual al invitado
      if (videoRef.current && videoRef.current.src && selectedVideo) {
        currentConn.send({
          type: "welcome-sync",
          filename: selectedVideo,
          time: videoRef.current.currentTime,
          isPlaying: !videoRef.current.paused,
        });
      }
    });

    currentConn.on("data", (data) => {
      switch (data.type) {
        case "chat":
          setMessages((prev) => [
            ...prev,
            {
              type: "chat",
              sender: data.name,
              text: data.text,
              color: data.color,
            },
          ]);
          break;
        case "system":
          setMessages((prev) => [...prev, { type: "system", text: data.text }]);
          break;
        case "video-src":
          if (videoRef.current) {
            videoRef.current.src = `${STREAM_URL}/${data.filename}`;
            setSelectedVideo(data.filename);
          }
          break;
        case "welcome-sync":
          if (videoRef.current) {
            ignoreVideoEvents.current = true;
            videoRef.current.src = `${STREAM_URL}/${data.filename}`;
            setSelectedVideo(data.filename);
            videoRef.current.currentTime = data.time;

            if (data.isPlaying) {
              videoRef.current.play().catch(() => {});
            }

            setTimeout(() => {
              ignoreVideoEvents.current = false;
            }, 500);
          }
          break;
        case "video-control":
          if (!videoRef.current) return;
          ignoreVideoEvents.current = true;
          videoRef.current.currentTime = data.time;
          if (data.action === "play") videoRef.current.play().catch(() => {});
          if (data.action === "pause") videoRef.current.pause();
          setTimeout(() => {
            ignoreVideoEvents.current = false;
          }, 300);
          break;
        default:
          break;
      }
    });
  };

  const handleCreateRoom = () => {
    const customId = roomIdInput.trim();
    setIsRoomJoined(true);

    const peer = customId ? new Peer(customId) : new Peer();
    peerRef.current = peer;

    peer.on("open", (id) => {
      setRoomId(id);
      setMessages([
        { type: "system", text: `Sala creada. ID para tu pareja: ${id}` },
      ]);
    });

    peer.on("connection", (connection) => {
      setupConnection(connection);
    });

    peer.on("error", (err) => {
      if (err.type === "unavailable-id") {
        alert(
          "El ID de sala solicitado ya está en uso. Por favor, elige otro o déjalo en blanco.",
        );
        setIsRoomJoined(false);
        if (peerRef.current) {
          peerRef.current.destroy();
          peerRef.current = null;
        }
      } else {
        alert("Ocurrió un error al crear la sala: " + err.message);
        setIsRoomJoined(false);
      }
    });
  };

  const handleJoinRoom = () => {
    if (!roomIdInput.trim())
      return alert("Por favor, ingresa un ID de sala válido.");
    setIsRoomJoined(true);
    setRoomId(roomIdInput.trim());

    const peer = new Peer();
    peerRef.current = peer;

    peer.on("open", () => {
      const connection = peer.connect(roomIdInput.trim());
      setupConnection(connection);
    });

    peer.on("error", (err) => {
      if (err.type === "peer-unavailable") {
        alert(
          "No se encontró la sala con ese ID. Verifica que tu pareja la haya creado correctamente.",
        );
        setIsRoomJoined(false);
        if (peerRef.current) {
          peerRef.current.destroy();
          peerRef.current = null;
        }
      } else {
        alert("Error al unirse a la sala: " + err.message);
        setIsRoomJoined(false);
      }
    });
  };

  // Manejar el cambio de video desde la lista del VPS
  const handleSelectVideo = (filename) => {
    if (!filename) return;
    setSelectedVideo(filename);
    const fullUrl = `${STREAM_URL}/${filename}`;

    if (videoRef.current) {
      videoRef.current.src = fullUrl;
    }

    if (connRef.current) {
      connRef.current.send({ type: "video-src", filename: filename });
    }
  };

  // Subir un video nuevo mediante la API
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("video", file);

    setIsUploading(true);
    setUploadProgress("Subiendo archivo...");

    try {
      const response = await fetch(`${API_URL}/upload`, {
        method: "POST",
        body: formData,
      });

      if (response.ok) {
        setUploadProgress("¡Subido con éxito!");
        await fetchVideos(); // Refrescar videoteca
      } else {
        setUploadProgress("Error al subir archivo");
      }
    } catch (err) {
      setUploadProgress("Fallo en la conexión");
    } finally {
      setTimeout(() => {
        setIsUploading(false);
        setUploadProgress("");
      }, 3000);
    }
  };

  const handleSendMessage = (e) => {
    if (e) e.preventDefault();
    if (!chatInput.trim() || !connRef.current) return;

    const msgData = {
      type: "chat",
      name: username || "Invitado",
      text: chatInput.trim(),
      color: chatColor,
    };

    setMessages((prev) => [
      ...prev,
      { type: "chat", sender: "Tú", text: msgData.text, color: msgData.color },
    ]);
    connRef.current.send(msgData);
    setChatInput("");
  };

  const broadcastVideoEvent = (action) => {
    if (ignoreVideoEvents.current || !connRef.current || !videoRef.current)
      return;
    connRef.current.send({
      type: "video-control",
      action: action,
      time: videoRef.current.currentTime,
    });
  };

  useEffect(() => {
    return () => {
      if (peerRef.current) peerRef.current.destroy();
    };
  }, []);

  return (
    <div className="bg-gray-900 text-white min-h-screen flex items-center justify-center font-sans p-4">
      {!isRoomJoined ? (
        /* INGRESO */
        <div className="bg-gray-800 p-8 rounded-lg shadow-xl w-full max-w-md">
          <h2 className="text-2xl font-bold mb-6 text-center text-indigo-400">
            ¡Cine en Pareja!
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                Tu Nombre
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full p-2.5 rounded bg-gray-700 border border-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Ej. Agus"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Color del Chat
              </label>
              <input
                type="color"
                value={chatColor}
                onChange={(e) => setChatColor(e.target.value)}
                className="w-full h-10 p-1 rounded bg-gray-700 border border-gray-600 cursor-pointer"
              />
            </div>
            <div className="pt-4 border-t border-gray-700 space-y-3">
              <button
                onClick={handleCreateRoom}
                className="w-full bg-indigo-600 hover:bg-indigo-700 p-2.5 rounded font-semibold transition"
              >
                Crear Sala (Anfitrión)
              </button>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={roomIdInput}
                  onChange={(e) => setRoomIdInput(e.target.value)}
                  className="w-2/3 p-2.5 rounded bg-gray-700 border border-gray-600 text-sm focus:outline-none"
                  placeholder="ID de la sala"
                />
                <button
                  onClick={handleJoinRoom}
                  className="w-1/3 bg-emerald-600 hover:bg-emerald-700 p-2.5 rounded font-semibold transition text-sm"
                >
                  Unirse
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* SALA DE STREAMING */
        <div className="w-full h-screen max-h-[95vh] flex flex-col md:flex-row gap-4">
          <div className="flex-1 flex flex-col justify-center bg-black rounded-lg overflow-hidden relative group">
            {/* Control superior para videoteca y carga */}
            <div className="absolute top-4 left-4 right-4 z-10 flex flex-col sm:flex-row gap-2 bg-gray-900/90 p-2 rounded shadow-lg opacity-100 group-hover:opacity-100 transition-opacity">
              <select
                value={selectedVideo}
                onChange={(e) => handleSelectVideo(e.target.value)}
                className="flex-1 p-2 text-sm rounded bg-gray-800 border border-gray-700 text-white focus:outline-none"
              >
                <option value="">-- Elige una película o serie --</option>
                {videoList.map((video, idx) => (
                  <option key={idx} value={video}>
                    {video.replace(/[-_]/g, " ")}
                  </option>
                ))}
              </select>

              <label className="bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded text-sm font-medium transition cursor-pointer text-center whitespace-nowrap">
                {isUploading ? uploadProgress : "Subir Película"}
                <input
                  type="file"
                  accept="video/*"
                  onChange={handleFileUpload}
                  disabled={isUploading}
                  className="hidden"
                />
              </label>
            </div>

            <video
              ref={videoRef}
              controls
              crossOrigin="anonymous"
              onPlay={() => broadcastVideoEvent("play")}
              onPause={() => broadcastVideoEvent("pause")}
              onSeeking={() => broadcastVideoEvent("seek")}
              className="w-full h-full max-h-[80vh] object-contain"
            ></video>

            <div className="text-xs text-gray-400 p-2 text-center bg-gray-950">
              ID de Sala:{" "}
              <span className="font-mono text-indigo-300 select-all font-bold">
                {roomId || "Generando..."}
              </span>
            </div>
          </div>

          {/* Chat Lateral */}
          <div className="w-full md:w-80 bg-gray-800 rounded-lg flex flex-col h-[35vh] md:h-auto">
            <div className="p-3 border-b border-gray-700 font-bold text-center text-indigo-400">
              Chat en Vivo
            </div>

            <div className="flex-1 p-3 overflow-y-auto space-y-2 text-sm">
              {messages.map((msg, index) => (
                <div key={index}>
                  {msg.type === "system" ? (
                    <div className="text-xs text-gray-500 italic text-center">
                      {msg.text}
                    </div>
                  ) : (
                    <div>
                      <span style={{ color: msg.color }} className="font-bold">
                        {msg.sender}:{" "}
                      </span>
                      <span className="text-gray-200">{msg.text}</span>
                    </div>
                  )}
                </div>
              ))}
              <div ref={chatBottomRef} />
            </div>

            <form
              onSubmit={handleSendMessage}
              className="p-3 border-t border-gray-700 flex gap-2"
            >
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                className="flex-1 p-2 rounded bg-gray-700 border border-gray-600 text-sm focus:outline-none"
                placeholder="Escribe un mensaje..."
              />
              <button
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-700 px-4 py-2 rounded text-sm font-semibold"
              >
                ➔
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
