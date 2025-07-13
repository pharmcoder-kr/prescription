// GUI 편집기
let guiEditorOpen = false;

function toggleGuiEditor() {
    const guiEditor = document.getElementById('guiEditor');
    guiEditorOpen = !guiEditorOpen;
    
    if (guiEditorOpen) {
        guiEditor.classList.add('open');
        loadGuiSettings();
    } else {
        guiEditor.classList.remove('open');
    }
}

function loadGuiSettings() {
    const settings = JSON.parse(localStorage.getItem('guiSettings') || '{}');
    
    // 색상 설정
    document.getElementById('primaryColor').value = settings.primaryColor || '#667eea';
    document.getElementById('secondaryColor').value = settings.secondaryColor || '#764ba2';
    document.getElementById('backgroundColor').value = settings.backgroundColor || '#f8f9fa';
    document.getElementById('textColor').value = settings.textColor || '#495057';
    
    // 카드 설정
    document.getElementById('cardRadius').value = settings.cardRadius || 15;
    document.getElementById('cardShadow').value = settings.cardShadow || 20;
    document.getElementById('cardPadding').value = settings.cardPadding || 20;
    
    // 애니메이션 설정
    document.getElementById('animationSpeed').value = settings.animationSpeed || 300;
    document.getElementById('hoverEffect').checked = settings.hoverEffect !== false;
    
    // 폰트 설정
    document.getElementById('fontSize').value = settings.fontSize || 14;
    document.getElementById('fontFamily').value = settings.fontFamily || 'Segoe UI';
    
    updatePreview();
}

function updatePreview() {
    const settings = getGuiSettings();
    
    // 미리보기 카드 업데이트
    const previewCard = document.querySelector('.preview-card');
    if (previewCard) {
        previewCard.style.borderRadius = `${settings.cardRadius}px`;
        previewCard.style.boxShadow = `0 ${settings.cardShadow}px ${settings.cardShadow * 1.5}px rgba(0,0,0,0.1)`;
        previewCard.style.padding = `${settings.cardPadding}px`;
        previewCard.style.backgroundColor = settings.backgroundColor;
        previewCard.style.color = settings.textColor;
    }
    
    // 미리보기 버튼 업데이트
    const previewButton = document.querySelector('.preview-button');
    if (previewButton) {
        previewButton.style.backgroundColor = settings.primaryColor;
        previewButton.style.borderRadius = `${Math.min(settings.cardRadius, 25)}px`;
        previewButton.style.fontSize = `${settings.fontSize}px`;
        previewButton.style.fontFamily = settings.fontFamily;
    }
    
    // 색상 미리보기 업데이트
    updateColorPreviews();
}

function getGuiSettings() {
    return {
        primaryColor: document.getElementById('primaryColor').value,
        secondaryColor: document.getElementById('secondaryColor').value,
        backgroundColor: document.getElementById('backgroundColor').value,
        textColor: document.getElementById('textColor').value,
        cardRadius: parseInt(document.getElementById('cardRadius').value),
        cardShadow: parseInt(document.getElementById('cardShadow').value),
        cardPadding: parseInt(document.getElementById('cardPadding').value),
        animationSpeed: parseInt(document.getElementById('animationSpeed').value),
        hoverEffect: document.getElementById('hoverEffect').checked,
        fontSize: parseInt(document.getElementById('fontSize').value),
        fontFamily: document.getElementById('fontFamily').value
    };
}

function updateColorPreviews() {
    const colors = ['primaryColor', 'secondaryColor', 'backgroundColor', 'textColor'];
    colors.forEach(colorId => {
        const colorValue = document.getElementById(colorId).value;
        const preview = document.getElementById(`${colorId}Preview`);
        if (preview) {
            preview.style.backgroundColor = colorValue;
        }
    });
}

function applyGuiSettings() {
    const settings = getGuiSettings();
    
    // CSS 변수 업데이트
    const root = document.documentElement;
    root.style.setProperty('--primary-color', settings.primaryColor);
    root.style.setProperty('--secondary-color', settings.secondaryColor);
    root.style.setProperty('--background-color', settings.backgroundColor);
    root.style.setProperty('--text-color', settings.textColor);
    root.style.setProperty('--card-radius', `${settings.cardRadius}px`);
    root.style.setProperty('--card-shadow', `${settings.cardShadow}px`);
    root.style.setProperty('--card-padding', `${settings.cardPadding}px`);
    root.style.setProperty('--animation-speed', `${settings.animationSpeed}ms`);
    root.style.setProperty('--font-size', `${settings.fontSize}px`);
    root.style.setProperty('--font-family', settings.fontFamily);
    
    // 호버 효과 설정
    const cards = document.querySelectorAll('.card');
    cards.forEach(card => {
        if (settings.hoverEffect) {
            card.style.transition = `all ${settings.animationSpeed}ms ease`;
        } else {
            card.style.transition = 'none';
        }
    });
    
    // 설정 저장
    localStorage.setItem('guiSettings', JSON.stringify(settings));
    
    showMessage('GUI 설정이 적용되었습니다!', 'success');
}

function resetGuiSettings() {
    if (confirm('모든 GUI 설정을 초기화하시겠습니까?')) {
        localStorage.removeItem('guiSettings');
        loadGuiSettings();
        applyGuiSettings();
        showMessage('GUI 설정이 초기화되었습니다!', 'info');
    }
}

// 이벤트 리스너 설정
document.addEventListener('DOMContentLoaded', function() {
    // 색상 변경 이벤트
    const colorInputs = ['primaryColor', 'secondaryColor', 'backgroundColor', 'textColor'];
    colorInputs.forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('input', updatePreview);
        }
    });
    
    // 슬라이더 변경 이벤트
    const sliders = ['cardRadius', 'cardShadow', 'cardPadding', 'animationSpeed', 'fontSize'];
    sliders.forEach(id => {
        const slider = document.getElementById(id);
        if (slider) {
            slider.addEventListener('input', updatePreview);
        }
    });
    
    // 체크박스 변경 이벤트
    const checkbox = document.getElementById('hoverEffect');
    if (checkbox) {
        checkbox.addEventListener('change', updatePreview);
    }
    
    // 폰트 변경 이벤트
    const fontSelect = document.getElementById('fontFamily');
    if (fontSelect) {
        fontSelect.addEventListener('change', updatePreview);
    }
}); 