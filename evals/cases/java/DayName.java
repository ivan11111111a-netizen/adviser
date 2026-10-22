class Days {
    static String dayType(int day) {
        String type = "";
        switch (day) {
            case 6:
            case 7:
                type = "выходной";
            default:
                type = "будний";
        }
        return type;
    }
}
