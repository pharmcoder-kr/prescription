// 시각적 레이아웃 에디터
class LayoutEditor {
    constructor() {
        this.selectedComponent = null;
        this.components = [];
        this.componentCounter = 0;
        this.init();
    }

    init() {
        this.setupDragAndDrop();
        this.setupCanvasEvents();
        this.loadLayout();
    }

    setupDragAndDrop() {
        // 컴포넌트 아이템 드래그 이벤트
        const componentItems = document.querySelectorAll('.component-item');
        componentItems.forEach(item => {
            item.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', item.dataset.component);
                item.classList.add('dragging');
            });

            item.addEventListener('dragend', (e) => {
                item.classList.remove('dragging');
            });
        });

        // 캔버스 드롭 이벤트
        const canvas = document.getElementById('canvas');
        if (canvas) {
            canvas.addEventListener('dragover', (e) => {
                e.preventDefault();
                const dropZone = canvas.querySelector('.drop-zone');
                if (dropZone) {
                    dropZone.classList.add('drag-over');
                }
            });

            canvas.addEventListener('dragleave', (e) => {
                e.preventDefault();
                const dropZone = canvas.querySelector('.drop-zone');
                if (dropZone) {
                    dropZone.classList.remove('drag-over');
                }
            });

            canvas.addEventListener('drop', (e) => {
                e.preventDefault();
                const componentType = e.dataTransfer.getData('text/plain');
                const dropZone = canvas.querySelector('.drop-zone');
                if (dropZone) {
                    dropZone.classList.remove('drag-over');
                }
                
                if (componentType) {
                    this.addComponent(componentType, e.offsetX, e.offsetY);
                }
            });
        }
    }

    setupCanvasEvents() {
        const canvas = document.getElementById('canvas');
        if (canvas) {
            // 캔버스 클릭 시 선택 해제
            canvas.addEventListener('click', (e) => {
                if (e.target === canvas || e.target.classList.contains('drop-zone')) {
                    this.deselectComponent();
                }
            });
        }
    }

    addComponent(type, x, y) {
        this.componentCounter++;
        const componentId = `component_${this.componentCounter}`;
        
        const component = {
            id: componentId,
            type: type,
            x: x,
            y: y,
            properties: this.getDefaultProperties(type)
        };

        this.components.push(component);
        this.renderComponent(component);
        this.selectComponent(componentId);
    }

    getDefaultProperties(type) {
        const defaults = {
            card: {
                title: '새 카드',
                content: '카드 내용을 입력하세요',
                backgroundColor: '#ffffff',
                textColor: '#000000',
                borderRadius: '8px',
                padding: '20px',
                margin: '10px'
            },
            table: {
                headers: ['제목1', '제목2', '제목3'],
                rows: [['데이터1', '데이터2', '데이터3']],
                backgroundColor: '#ffffff',
                borderColor: '#dee2e6',
                textColor: '#000000'
            },
            button: {
                text: '버튼',
                backgroundColor: '#007bff',
                textColor: '#ffffff',
                borderRadius: '5px',
                padding: '10px 20px',
                fontSize: '14px'
            },
            input: {
                placeholder: '입력하세요',
                type: 'text',
                width: '200px',
                height: '40px',
                borderColor: '#ced4da',
                backgroundColor: '#ffffff'
            },
            label: {
                text: '라벨',
                textColor: '#495057',
                fontSize: '14px',
                fontWeight: '500'
            },
            divider: {
                height: '1px',
                backgroundColor: '#dee2e6',
                margin: '15px 0'
            }
        };

        return defaults[type] || {};
    }

    renderComponent(component) {
        const canvas = document.getElementById('canvas');
        if (!canvas) return;

        const dropZone = canvas.querySelector('.drop-zone');
        
        // 첫 번째 컴포넌트가 추가되면 드롭존 제거
        if (dropZone) {
            dropZone.remove();
        }

        const componentElement = document.createElement('div');
        componentElement.id = component.id;
        componentElement.className = 'canvas-component';
        componentElement.style.position = 'absolute';
        componentElement.style.left = `${component.x}px`;
        componentElement.style.top = `${component.y}px`;
        componentElement.dataset.componentId = component.id;

        // 컴포넌트 내용 렌더링
        componentElement.innerHTML = this.renderComponentContent(component);

        // 컴포넌트 컨트롤 추가
        const controls = document.createElement('div');
        controls.className = 'component-controls';
        controls.innerHTML = `
            <button class="btn-duplicate" onclick="layoutEditor.duplicateComponent('${component.id}')" title="복제">
                <i class="fas fa-copy"></i>
            </button>
            <button class="btn-delete" onclick="layoutEditor.deleteComponent('${component.id}')" title="삭제">
                <i class="fas fa-trash"></i>
            </button>
        `;
        componentElement.appendChild(controls);

        // 클릭 이벤트
        componentElement.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectComponent(component.id);
        });

        canvas.appendChild(componentElement);
    }

    renderComponentContent(component) {
        const props = component.properties;
        
        switch (component.type) {
            case 'card':
                return `
                    <div class="component-card" style="
                        background-color: ${props.backgroundColor};
                        color: ${props.textColor};
                        border-radius: ${props.borderRadius};
                        padding: ${props.padding};
                        margin: ${props.margin};
                    ">
                        <h5>${props.title}</h5>
                        <p>${props.content}</p>
                    </div>
                `;
            
            case 'table':
                return `
                    <div class="component-table" style="
                        background-color: ${props.backgroundColor};
                        color: ${props.textColor};
                        border: 1px solid ${props.borderColor};
                    ">
                        <table class="table">
                            <thead>
                                <tr>
                                    ${props.headers.map(header => `<th>${header}</th>`).join('')}
                                </tr>
                            </thead>
                            <tbody>
                                ${props.rows.map(row => `
                                    <tr>
                                        ${row.map(cell => `<td>${cell}</td>`).join('')}
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                `;
            
            case 'button':
                return `
                    <button class="component-button" style="
                        background-color: ${props.backgroundColor};
                        color: ${props.textColor};
                        border-radius: ${props.borderRadius};
                        padding: ${props.padding};
                        font-size: ${props.fontSize};
                    ">
                        ${props.text}
                    </button>
                `;
            
            case 'input':
                return `
                    <input type="${props.type}" class="component-input" placeholder="${props.placeholder}" style="
                        width: ${props.width};
                        height: ${props.height};
                        border: 1px solid ${props.borderColor};
                        background-color: ${props.backgroundColor};
                    ">
                `;
            
            case 'label':
                return `
                    <label class="component-label" style="
                        color: ${props.textColor};
                        font-size: ${props.fontSize};
                        font-weight: ${props.fontWeight};
                    ">
                        ${props.text}
                    </label>
                `;
            
            case 'divider':
                return `
                    <hr class="component-divider" style="
                        height: ${props.height};
                        background-color: ${props.backgroundColor};
                        margin: ${props.margin};
                        border: none;
                    ">
                `;
            
            default:
                return `<div>알 수 없는 컴포넌트: ${component.type}</div>`;
        }
    }

    selectComponent(componentId) {
        // 이전 선택 해제
        this.deselectComponent();
        
        // 새 컴포넌트 선택
        this.selectedComponent = componentId;
        const componentElement = document.getElementById(componentId);
        if (componentElement) {
            componentElement.classList.add('selected');
            this.showProperties(componentId);
        }
    }

    deselectComponent() {
        if (this.selectedComponent) {
            const componentElement = document.getElementById(this.selectedComponent);
            if (componentElement) {
                componentElement.classList.remove('selected');
            }
            this.selectedComponent = null;
            this.hideProperties();
        }
    }

    showProperties(componentId) {
        const component = this.components.find(c => c.id === componentId);
        if (!component) return;

        const propertiesContent = document.getElementById('propertiesContent');
        if (propertiesContent) {
            propertiesContent.innerHTML = this.generatePropertiesForm(component);
            this.setupPropertyListeners(component);
        }
    }

    hideProperties() {
        const propertiesContent = document.getElementById('propertiesContent');
        if (propertiesContent) {
            propertiesContent.innerHTML = '<p class="text-muted">컴포넌트를 선택하면 속성이 표시됩니다.</p>';
        }
    }

    generatePropertiesForm(component) {
        const props = component.properties;
        let html = `<h6>${component.type.toUpperCase()} 속성</h6>`;

        switch (component.type) {
            case 'card':
                html += `
                    <div class="property-group">
                        <label>제목</label>
                        <input type="text" id="card_title" value="${props.title}">
                    </div>
                    <div class="property-group">
                        <label>내용</label>
                        <textarea id="card_content" rows="3">${props.content}</textarea>
                    </div>
                    <div class="property-group">
                        <label>배경색</label>
                        <input type="color" id="card_bg" value="${props.backgroundColor}">
                    </div>
                    <div class="property-group">
                        <label>텍스트색</label>
                        <input type="color" id="card_text" value="${props.textColor}">
                    </div>
                    <div class="property-group">
                        <label>둥글기</label>
                        <input type="range" id="card_radius" min="0" max="20" value="${parseInt(props.borderRadius)}">
                    </div>
                `;
                break;

            case 'button':
                html += `
                    <div class="property-group">
                        <label>텍스트</label>
                        <input type="text" id="button_text" value="${props.text}">
                    </div>
                    <div class="property-group">
                        <label>배경색</label>
                        <input type="color" id="button_bg" value="${props.backgroundColor}">
                    </div>
                    <div class="property-group">
                        <label>텍스트색</label>
                        <input type="color" id="button_text_color" value="${props.textColor}">
                    </div>
                    <div class="property-group">
                        <label>둥글기</label>
                        <input type="range" id="button_radius" min="0" max="20" value="${parseInt(props.borderRadius)}">
                    </div>
                    <div class="property-group">
                        <label>폰트 크기</label>
                        <input type="range" id="button_font" min="10" max="24" value="${parseInt(props.fontSize)}">
                    </div>
                `;
                break;

            case 'input':
                html += `
                    <div class="property-group">
                        <label>플레이스홀더</label>
                        <input type="text" id="input_placeholder" value="${props.placeholder}">
                    </div>
                    <div class="property-group">
                        <label>타입</label>
                        <select id="input_type">
                            <option value="text" ${props.type === 'text' ? 'selected' : ''}>텍스트</option>
                            <option value="password" ${props.type === 'password' ? 'selected' : ''}>비밀번호</option>
                            <option value="email" ${props.type === 'email' ? 'selected' : ''}>이메일</option>
                            <option value="number" ${props.type === 'number' ? 'selected' : ''}>숫자</option>
                        </select>
                    </div>
                    <div class="property-group">
                        <label>너비</label>
                        <input type="range" id="input_width" min="100" max="400" value="${parseInt(props.width)}">
                    </div>
                    <div class="property-group">
                        <label>높이</label>
                        <input type="range" id="input_height" min="30" max="80" value="${parseInt(props.height)}">
                    </div>
                `;
                break;

            case 'label':
                html += `
                    <div class="property-group">
                        <label>텍스트</label>
                        <input type="text" id="label_text" value="${props.text}">
                    </div>
                    <div class="property-group">
                        <label>텍스트색</label>
                        <input type="color" id="label_color" value="${props.textColor}">
                    </div>
                    <div class="property-group">
                        <label>폰트 크기</label>
                        <input type="range" id="label_font" min="10" max="24" value="${parseInt(props.fontSize)}">
                    </div>
                `;
                break;

            default:
                html += '<p>이 컴포넌트는 편집할 수 없습니다.</p>';
        }

        return html;
    }

    setupPropertyListeners(component) {
        switch (component.type) {
            case 'card':
                this.setupCardListeners(component);
                break;
            case 'button':
                this.setupButtonListeners(component);
                break;
            case 'input':
                this.setupInputListeners(component);
                break;
            case 'label':
                this.setupLabelListeners(component);
                break;
        }
    }

    setupCardListeners(component) {
        const listeners = [
            { id: 'card_title', property: 'title' },
            { id: 'card_content', property: 'content' },
            { id: 'card_bg', property: 'backgroundColor' },
            { id: 'card_text', property: 'textColor' },
            { id: 'card_radius', property: 'borderRadius', suffix: 'px' }
        ];

        listeners.forEach(listener => {
            const element = document.getElementById(listener.id);
            if (element) {
                element.addEventListener('input', (e) => {
                    const value = listener.suffix ? e.target.value + listener.suffix : e.target.value;
                    component.properties[listener.property] = value;
                    this.updateComponent(component);
                });
            }
        });
    }

    setupButtonListeners(component) {
        const listeners = [
            { id: 'button_text', property: 'text' },
            { id: 'button_bg', property: 'backgroundColor' },
            { id: 'button_text_color', property: 'textColor' },
            { id: 'button_radius', property: 'borderRadius', suffix: 'px' },
            { id: 'button_font', property: 'fontSize', suffix: 'px' }
        ];

        listeners.forEach(listener => {
            const element = document.getElementById(listener.id);
            if (element) {
                element.addEventListener('input', (e) => {
                    const value = listener.suffix ? e.target.value + listener.suffix : e.target.value;
                    component.properties[listener.property] = value;
                    this.updateComponent(component);
                });
            }
        });
    }

    setupInputListeners(component) {
        const listeners = [
            { id: 'input_placeholder', property: 'placeholder' },
            { id: 'input_type', property: 'type' },
            { id: 'input_width', property: 'width', suffix: 'px' },
            { id: 'input_height', property: 'height', suffix: 'px' }
        ];

        listeners.forEach(listener => {
            const element = document.getElementById(listener.id);
            if (element) {
                element.addEventListener('input', (e) => {
                    const value = listener.suffix ? e.target.value + listener.suffix : e.target.value;
                    component.properties[listener.property] = value;
                    this.updateComponent(component);
                });
            }
        });
    }

    setupLabelListeners(component) {
        const listeners = [
            { id: 'label_text', property: 'text' },
            { id: 'label_color', property: 'textColor' },
            { id: 'label_font', property: 'fontSize', suffix: 'px' }
        ];

        listeners.forEach(listener => {
            const element = document.getElementById(listener.id);
            if (element) {
                element.addEventListener('input', (e) => {
                    const value = listener.suffix ? e.target.value + listener.suffix : e.target.value;
                    component.properties[listener.property] = value;
                    this.updateComponent(component);
                });
            }
        });
    }

    updateComponent(component) {
        const componentElement = document.getElementById(component.id);
        if (componentElement) {
            componentElement.innerHTML = this.renderComponentContent(component);
            
            // 컨트롤 다시 추가
            const controls = document.createElement('div');
            controls.className = 'component-controls';
            controls.innerHTML = `
                <button class="btn-duplicate" onclick="layoutEditor.duplicateComponent('${component.id}')" title="복제">
                    <i class="fas fa-copy"></i>
                </button>
                <button class="btn-delete" onclick="layoutEditor.deleteComponent('${component.id}')" title="삭제">
                    <i class="fas fa-trash"></i>
                </button>
            `;
            componentElement.appendChild(controls);
        }
    }

    duplicateComponent(componentId) {
        const originalComponent = this.components.find(c => c.id === componentId);
        if (!originalComponent) return;

        this.componentCounter++;
        const newComponentId = `component_${this.componentCounter}`;
        
        const newComponent = {
            id: newComponentId,
            type: originalComponent.type,
            x: originalComponent.x + 20,
            y: originalComponent.y + 20,
            properties: JSON.parse(JSON.stringify(originalComponent.properties))
        };

        this.components.push(newComponent);
        this.renderComponent(newComponent);
        this.selectComponent(newComponentId);
    }

    deleteComponent(componentId) {
        const componentElement = document.getElementById(componentId);
        if (componentElement) {
            componentElement.remove();
        }

        this.components = this.components.filter(c => c.id !== componentId);
        this.deselectComponent();

        // 컴포넌트가 없으면 드롭존 다시 표시
        if (this.components.length === 0) {
            this.showDropZone();
        }
    }

    showDropZone() {
        const canvas = document.getElementById('canvas');
        if (canvas) {
            const dropZone = document.createElement('div');
            dropZone.className = 'drop-zone';
            dropZone.innerHTML = '<p>컴포넌트를 여기에 드래그하여 배치하세요</p>';
            canvas.appendChild(dropZone);
        }
    }

    saveLayout() {
        const layoutData = {
            components: this.components,
            timestamp: new Date().toISOString()
        };

        localStorage.setItem('layoutEditorData', JSON.stringify(layoutData));
        this.showMessage('레이아웃이 저장되었습니다.', 'success');
    }

    loadLayout() {
        const savedData = localStorage.getItem('layoutEditorData');
        if (savedData) {
            try {
                const layoutData = JSON.parse(savedData);
                this.components = layoutData.components || [];
                this.componentCounter = this.components.length;
                
                // 컴포넌트 다시 렌더링
                this.components.forEach(component => {
                    this.renderComponent(component);
                });

                if (this.components.length === 0) {
                    this.showDropZone();
                }
            } catch (error) {
                console.error('레이아웃 로드 실패:', error);
            }
        } else {
            this.showDropZone();
        }
    }

    resetLayout() {
        if (confirm('모든 컴포넌트를 삭제하시겠습니까?')) {
            this.components.forEach(component => {
                const element = document.getElementById(component.id);
                if (element) {
                    element.remove();
                }
            });
            
            this.components = [];
            this.componentCounter = 0;
            this.deselectComponent();
            this.showDropZone();
            localStorage.removeItem('layoutEditorData');
            this.showMessage('레이아웃이 초기화되었습니다.', 'info');
        }
    }

    showMessage(message, type = 'info') {
        console.log(`[${type.toUpperCase()}] ${message}`);
    }
}

// 전역 변수로 레이아웃 에디터 인스턴스 생성
let layoutEditor;

// 레이아웃 에디터 토글 함수
function toggleLayoutEditor() {
    const layoutEditorElement = document.getElementById('layoutEditor');
    if (!layoutEditorElement) return;

    const isVisible = layoutEditorElement.style.display !== 'none';
    
    if (!isVisible) {
        layoutEditorElement.style.display = 'flex';
        if (!layoutEditor) {
            layoutEditor = new LayoutEditor();
        }
    } else {
        layoutEditorElement.style.display = 'none';
    }
}

// 레이아웃 저장 함수
function saveLayout() {
    if (layoutEditor) {
        layoutEditor.saveLayout();
    }
}

// 레이아웃 초기화 함수
function resetLayout() {
    if (layoutEditor) {
        layoutEditor.resetLayout();
    }
} 