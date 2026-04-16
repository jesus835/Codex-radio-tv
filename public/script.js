function loginYouTube() {
    fetch('/login-youtube')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                alert('✅ Ventana de YouTube abierta. Inicia sesión y luego cierra la ventana.');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert('❌ Error al abrir ventana de login');
        });
}

function showTab(tabName) {
    const tabs = document.querySelectorAll('.tab-content');
    const buttons = document.querySelectorAll('.tab-button');
    
    tabs.forEach(tab => tab.classList.remove('active'));
    buttons.forEach(btn => btn.classList.remove('active'));
    
    document.getElementById(`${tabName}-tab`).classList.add('active');
    event.target.classList.add('active');
}

function streamVideo() {
    const url = document.getElementById('stream-url').value.trim();
    
    if (!url) {
        alert('Por favor ingresa una URL de YouTube');
        return;
    }

    const playerSection = document.getElementById('stream-player');
    const video = document.getElementById('stream-video');
    
    video.src = `/stream?url=${encodeURIComponent(url)}`;
    playerSection.style.display = 'block';
    
    video.load();
    video.play().catch(err => {
        console.error('Error reproduciendo video:', err);
        alert('Error al reproducir el video. Verifica que yt-dlp esté instalado.');
    });
}

function downloadVideo() {
    const url = document.getElementById('download-url').value.trim();
    
    if (!url) {
        alert('Por favor ingresa una URL de YouTube');
        return;
    }

    const statusDiv = document.getElementById('download-status');
    statusDiv.className = 'status-section loading';
    statusDiv.innerHTML = '<div class="loading-spinner"></div>Descargando video... Esto puede tomar varios minutos.';
    statusDiv.style.display = 'block';

    fetch(`/descargar?url=${encodeURIComponent(url)}`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                statusDiv.className = 'status-section success';
                statusDiv.innerHTML = `✅ ${data.message}`;
                
                const playerSection = document.getElementById('download-player');
                const video = document.getElementById('download-video');
                const source = document.getElementById('download-source');
                
                source.src = data.videoUrl;
                video.load();
                playerSection.style.display = 'block';
                
                setTimeout(() => {
                    statusDiv.style.display = 'none';
                }, 3000);
            } else {
                throw new Error(data.error || 'Error desconocido');
            }
        })
        .catch(error => {
            statusDiv.className = 'status-section error';
            statusDiv.innerHTML = `❌ Error: ${error.message}`;
        });
}

function loadLibrary() {
    const libraryList = document.getElementById('library-list');
    libraryList.innerHTML = '<div class="loading-spinner"></div>Cargando biblioteca...';

    fetch('/videos-list')
        .then(response => response.json())
        .then(data => {
            if (data.videos.length === 0) {
                libraryList.innerHTML = '<p class="empty-message">No hay videos descargados</p>';
                return;
            }

            libraryList.innerHTML = '';
            data.videos.forEach(video => {
                const videoItem = document.createElement('div');
                videoItem.className = 'video-item';
                
                videoItem.innerHTML = `
                    <span class="video-name">${video}</span>
                    <div class="video-actions">
                        <button class="btn-small btn-play" onclick="playFromLibrary('${video}')">
                            ▶️ Reproducir
                        </button>
                    </div>
                `;
                
                libraryList.appendChild(videoItem);
            });
        })
        .catch(error => {
            libraryList.innerHTML = `<p class="empty-message">Error cargando biblioteca: ${error.message}</p>`;
        });
}

function playFromLibrary(filename) {
    const playerSection = document.getElementById('library-player');
    const video = document.getElementById('library-video');
    const source = document.getElementById('library-source');
    
    source.src = `/videos/${filename}`;
    video.load();
    playerSection.style.display = 'block';
    
    video.play();
    
    playerSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
