int array_sum(int numbers[]) {
    int count = sizeof(numbers) / sizeof(numbers[0]);
    int sum = 0;
    for (int i = 0; i < count; i++) {
        sum += numbers[i];
    }
    return sum;
}
