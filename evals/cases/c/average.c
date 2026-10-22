double average(const int *grades, int count) {
    int total = 0;
    for (int i = 0; i < count; i++) {
        total += grades[i];
    }
    return total / count;
}
