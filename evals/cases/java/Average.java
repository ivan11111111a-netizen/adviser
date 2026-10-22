class Stats {
    static double average(int[] scores) {
        int sum = 0;
        for (int score : scores) {
            sum += score;
        }
        return sum / scores.length;
    }
}
