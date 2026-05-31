let cursor = { x: 0, y: 0 };
async function noOp() { }
const supported = {
    isSupported: process.platform === 'darwin',
    async moveMouse(x, y) {
        cursor = { x, y };
    },
    async mouseLocation() {
        return cursor;
    },
    async key(_key, _action = 'click') {
        await noOp();
    },
    async keys(_keys) {
        await noOp();
    },
    async leftClick() {
        await noOp();
    },
    async rightClick() {
        await noOp();
    },
    async doubleClick() {
        await noOp();
    },
    async middleClick() {
        await noOp();
    },
    async dragMouse(x, y) {
        cursor = { x, y };
    },
    async scroll(_x, _y) {
        await noOp();
    },
    async type(_text) {
        await noOp();
    },
    async mouseButton(_button, _action = 'click', _count = 1) {
        await noOp();
    },
    async mouseScroll(_amount, _axis = 'vertical') {
        await noOp();
    },
    async typeText(_text) {
        await noOp();
    },
    getFrontmostAppInfo() {
        return null;
    },
};
export default supported;
