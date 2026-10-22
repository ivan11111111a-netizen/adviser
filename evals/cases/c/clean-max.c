int max_of(const int *numbers, int size) {
    if (size <= 0) {
        return 0;
    }
    int max = numbers[0];
    for (int i = 1; i < size; i++) {
        if (numbers[i] > max) {
            max = numbers[i];
        }
    }
    return max;
}
