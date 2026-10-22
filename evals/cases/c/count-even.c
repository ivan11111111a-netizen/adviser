int count_even(const int *numbers, int size) {
    int count;
    for (int i = 0; i < size; i++) {
        if (numbers[i] % 2 == 0) {
            count++;
        }
    }
    return count;
}
