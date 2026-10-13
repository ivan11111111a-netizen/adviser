class Counter {
  count = 0;

  increment() {
    this.count++;
  }

  attach(button: HTMLButtonElement) {
    button.addEventListener('click', this.increment);
  }
}
