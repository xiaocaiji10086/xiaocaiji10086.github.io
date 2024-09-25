const gameBoard = document.getElementById('game-board');
const newGameButton = document.getElementById('new-game');
const scoreElement = document.getElementById('score-value');
const gameOverModal = document.getElementById('game-over');
const finalScoreElement = document.getElementById('final-score');
const restartGameButton = document.getElementById('restart-game');
let board = [];
let score = 0;
const historyList = document.getElementById('history-list');
let gameHistory = JSON.parse(localStorage.getItem('gameHistory')) || [];

function initializeGame() {
    board = Array(4).fill().map(() => Array(4).fill(0));
    score = 0;
    updateScore();
    addNewTile();
    addNewTile();
    renderBoard();
    hideGameOverModal();
}

function updateScore() {
    scoreElement.textContent = score;
}

function addNewTile() {
    const emptyTiles = [];
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            if (board[i][j] === 0) {
                emptyTiles.push({row: i, col: j});
            }
        }
    }
    if (emptyTiles.length > 0) {
        const {row, col} = emptyTiles[Math.floor(Math.random() * emptyTiles.length)];
        board[row][col] = Math.random() < 0.9 ? 2 : 4;
    }
}

function renderBoard() {
    gameBoard.innerHTML = '';
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            const tile = document.createElement('div');
            tile.className = 'tile';
            const value = board[i][j];
            if (value !== 0) {
                tile.textContent = value;
                tile.setAttribute('data-value', value);
            } else {
                tile.textContent = '';
                tile.setAttribute('data-value', '0');
            }
            gameBoard.appendChild(tile);
        }
    }
}

function move(direction) {
    let moved = false;
    let newBoard = JSON.parse(JSON.stringify(board));

    function moveLeft() {
        for (let i = 0; i < 4; i++) {
            let row = newBoard[i].filter(tile => tile !== 0);
            for (let j = 0; j < row.length - 1; j++) {
                if (row[j] === row[j + 1]) {
                    row[j] *= 2;
                    score += row[j];
                    row[j + 1] = 0;
                    moved = true;
                }
            }
            row = row.filter(tile => tile !== 0);
            while (row.length < 4) {
                row.push(0);
            }
            if (JSON.stringify(newBoard[i]) !== JSON.stringify(row)) {
                moved = true;
            }
            newBoard[i] = row;
        }
    }

    switch (direction) {
        case 'left':
            moveLeft();
            break;
        case 'right':
            newBoard.forEach(row => row.reverse());
            moveLeft();
            newBoard.forEach(row => row.reverse());
            break;
        case 'up':
            console.log('Before transpose (up):', JSON.parse(JSON.stringify(newBoard)));
            newBoard = transpose(newBoard);
            console.log('After transpose (up):', JSON.parse(JSON.stringify(newBoard)));
            moveLeft();
            newBoard = transpose(newBoard);
            console.log('Final board (up):', JSON.parse(JSON.stringify(newBoard)));
            break;
        case 'down':
            console.log('Before transpose (down):', JSON.parse(JSON.stringify(newBoard)));
            newBoard = transpose(newBoard);
            newBoard.forEach(row => row.reverse());
            console.log('After transpose and reverse (down):', JSON.parse(JSON.stringify(newBoard)));
            moveLeft();
            newBoard.forEach(row => row.reverse());
            newBoard = transpose(newBoard);
            console.log('Final board (down):', JSON.parse(JSON.stringify(newBoard)));
            break;
    }

    if (moved) {
        board = newBoard;
        addNewTile();
        renderBoard();
        updateScore();
        if (isGameOver()) {
            showGameOverModal();
        }
    }
}

function isGameOver() {
    // 检查是否有空格
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            if (board[i][j] === 0) {
                return false;
            }
        }
    }

    // 检查是否有相邻的相同数字
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            if (j < 3 && board[i][j] === board[i][j + 1]) {
                return false;
            }
            if (i < 3 && board[i][j] === board[i + 1][j]) {
                return false;
            }
        }
    }

    return true;
}

function showGameOverModal() {
    gameOverModal.style.display = 'block';
    finalScoreElement.textContent = score;
    addToHistory();
}

function hideGameOverModal() {
    gameOverModal.style.display = 'none';
}

function transpose(matrix) {
    return matrix[0].map((_, colIndex) => matrix.map(row => row[colIndex]));
}

function addToHistory() {
    gameHistory.push(score);
    saveHistory();
    renderHistory();
}

function saveHistory() {
    localStorage.setItem('gameHistory', JSON.stringify(gameHistory));
}

function renderHistory() {
    historyList.innerHTML = '';
    gameHistory.forEach((score, index) => {
        const li = document.createElement('li');
        li.textContent = `第 ${index + 1} 局: ${score} 分`;
        historyList.appendChild(li);
    });
}

document.addEventListener('keydown', (e) => {
    switch (e.key) {
        case 'ArrowLeft':
            move('left');
            break;
        case 'ArrowRight':
            move('right');
            break;
        case 'ArrowUp':
            move('up');
            break;
        case 'ArrowDown':
            move('down');
            break;
    }
});

newGameButton.addEventListener('click', () => {
    if (score > 0) {
        addToHistory();
    }
    initializeGame();
});

restartGameButton.addEventListener('click', () => {
    hideGameOverModal();
    initializeGame();
});

document.addEventListener('DOMContentLoaded', () => {
    initializeGame();
    renderHistory();
});

// 添加触摸事件支持
let touchStartX = 0;
let touchStartY = 0;
let touchEndX = 0;
let touchEndY = 0;

document.addEventListener('touchstart', function(event) {
    touchStartX = event.touches[0].clientX;
    touchStartY = event.touches[0].clientY;
}, false);

document.addEventListener('touchend', function(event) {
    touchEndX = event.changedTouches[0].clientX;
    touchEndY = event.changedTouches[0].clientY;
    handleSwipe();
}, false);

function handleSwipe() {
    let dx = touchEndX - touchStartX;
    let dy = touchEndY - touchStartY;

    if (Math.abs(dx) > Math.abs(dy)) {
        // 水平滑动
        if (dx > 0) {
            move('right');
        } else {
            move('left');
        }
    } else {
        // 垂直滑动
        if (dy > 0) {
            move('down');
        } else {
            move('up');
        }
    }
}

document.getElementById('clear-history').addEventListener('click', () => {
    gameHistory = [];
    saveHistory();
    renderHistory();
});

// 获取显示屏元素
const display = document.getElementById('display');
let currentInput = '';
let operator = '';
let previousInput = '';

// 更新显示屏
function updateDisplay(value) {
    display.value = value;
}

// 清除显示屏
function clearDisplay() {
    currentInput = '';
    previousInput = '';
    operator = '';
    updateDisplay('0');
}

// 删除最后一个字符
function deleteLast() {
    currentInput = currentInput.slice(0, -1);
    updateDisplay(currentInput || '0');
}

// 计算百分比
function calculatePercentage() {
    if (currentInput === '') return;
    currentInput = (parseFloat(currentInput) / 100).toString();
    updateDisplay(currentInput);
}

// 追加字符到显示屏
function appendToDisplay(value) {
    currentInput += value;
    updateDisplay(currentInput);
}

// 执行运算
function performOperation(op) {
    if (currentInput === '') return;
    if (previousInput !== '') {
        calculate();
    }
    operator = op;
    previousInput = currentInput;
    currentInput = '';
}

// 计算结果
function calculate() {
    if (currentInput === '' || previousInput === '') return;
    let result;
    const prev = parseFloat(previousInput);
    const current = parseFloat(currentInput);
    switch (operator) {
        case '+':
            result = prev + current;
            break;
        case '-':
            result = prev - current;
            break;
        case '*':
            result = prev * current;
            break;
        case '/':
            result = prev / current;
            break;
        default:
            return;
    }
    updateDisplay(result);
    addToHistory(`${previousInput} ${operator} ${currentInput} = ${result}`);
    currentInput = result.toString();
    previousInput = '';
    operator = '';
}

// 返回主页
function returnHome() {
    window.location.href = 'index.html';
}

// 添加记录到历史
function addToHistory(record) {
    const li = document.createElement('li');
    li.textContent = record;
    historyList.appendChild(li);
}

// 清除历史记录
function clearHistory() {
    historyList.innerHTML = '';
}

// 绑定按钮点击事件
document.querySelectorAll('.button').forEach(button => {
    button.addEventListener('click', () => {
        const value = button.textContent;
        if (button.classList.contains('operator')) {
            performOperation(value);
        } else {
            appendToDisplay(value);
        }
    });
});

document.getElementById('clear').addEventListener('click', clearDisplay);
document.getElementById('delete').addEventListener('click', deleteLast);
document.getElementById('equals').addEventListener('click', calculate);
document.querySelector('.clear-history').addEventListener('click', clearHistory);
document.querySelector('.return-home').addEventListener('click', returnHome);